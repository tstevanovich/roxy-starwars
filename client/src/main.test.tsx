import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';

const root = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => root) }));
vi.mock('./AuthGate.tsx', () => ({
  default: ({ children }) => children({ email: 'owner@example.test' })
}));
vi.mock('./App.tsx', () => ({ default: ({ account }) => <main>{account.email}</main> }));

test('bootstraps the authenticated app with its theme and root container', async () => {
  const container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  await import('./main.tsx');
  const { createRoot } = await import('react-dom/client');
  expect(createRoot).toHaveBeenCalledWith(container);
  expect(root.render).toHaveBeenCalledOnce();
  render(root.render.mock.calls[0][0] as ReactNode);
  expect(screen.getByRole('main')).toHaveTextContent('owner@example.test');
  container.remove();
});
