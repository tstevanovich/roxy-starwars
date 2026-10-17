import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { request } from './api.js';
import App from './App.jsx';
import { theme } from './theme.js';

vi.mock('./api.js', () => ({ request: vi.fn() }));

function renderApp() {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <CssBaseline />
        <App />
      </LocalizationProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  vi.mocked(request).mockReset();
});

test('shows a loading indicator and disables the task form while loading', () => {
  vi.mocked(request).mockReturnValueOnce(new Promise(() => {}));
  renderApp();

  expect(screen.getByRole('progressbar', { name: 'Loading tasks' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /new task/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();
});

test('adds, completes, and deletes a task through the API', async () => {
  const user = userEvent.setup();
  const task = { _id: 'task-1', title: 'Build my app', completed: false };
  vi.mocked(request)
    .mockResolvedValueOnce({ tasks: [] })
    .mockResolvedValueOnce({ task })
    .mockResolvedValueOnce({ task: { ...task, completed: true } })
    .mockResolvedValueOnce(null);

  renderApp();
  expect(await screen.findByText('A little room for big ideas.')).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: /new task/i }), task.title);
  await user.click(screen.getByRole('button', { name: 'Add task' }));

  expect(await screen.findByRole('checkbox', { name: task.title })).not.toBeChecked();
  expect(request).toHaveBeenCalledWith('/tasks', {
    method: 'POST',
    body: { title: task.title }
  });
  expect(screen.getByRole('textbox', { name: /new task/i })).toHaveValue('');

  await user.click(screen.getByRole('checkbox', { name: task.title }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: task.title })).toBeChecked());
  expect(request).toHaveBeenCalledWith('/tasks/task-1', {
    method: 'PATCH',
    body: { completed: true }
  });

  await user.click(screen.getByRole('button', { name: `Delete ${task.title}` }));
  await waitFor(() =>
    expect(screen.queryByRole('checkbox', { name: task.title })).not.toBeInTheDocument()
  );
  expect(request).toHaveBeenCalledWith('/tasks/task-1', { method: 'DELETE' });
  expect(screen.getByText('A little room for big ideas.')).toBeInTheDocument();
});

test('shows a load error and lets the user retry', async () => {
  const user = userEvent.setup();
  vi.mocked(request)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ tasks: [] });
  renderApp();

  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('A little room for big ideas.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});

test('retains a task when deleting it fails', async () => {
  const user = userEvent.setup();
  const task = { _id: 'task-1', title: 'Keep my task', completed: false };
  vi.mocked(request)
    .mockResolvedValueOnce({ tasks: [task] })
    .mockRejectedValueOnce(new Error('Could not delete task.'));
  renderApp();

  await user.click(await screen.findByRole('button', { name: `Delete ${task.title}` }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete task.');
  expect(screen.getByRole('checkbox', { name: task.title })).toBeInTheDocument();
});
