import AddRounded from '@mui/icons-material/AddRounded';
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

import { request } from './api.js';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    request('/tasks', { signal: controller.signal })
      .then((data) => setTasks(data.tasks))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(
            `Could not load tasks. Check that the API and MongoDB are running. ${error.message}`
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  async function mutate(operation) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function addTask(event) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    await mutate(async () => {
      const { task } = await request('/tasks', {
        method: 'POST',
        body: { title: title.trim() }
      });
      setTasks((current) => [task, ...current]);
      setTitle('');
    });
  }

  function toggleTask(task) {
    return mutate(async () => {
      const { task: updated } = await request(`/tasks/${task._id}`, {
        method: 'PATCH',
        body: { completed: !task.completed }
      });
      setTasks((current) => current.map((item) => (item._id === updated._id ? updated : item)));
    });
  }

  function deleteTask(task) {
    return mutate(async () => {
      await request(`/tasks/${task._id}`, { method: 'DELETE' });
      setTasks((current) => current.filter((item) => item._id !== task._id));
    });
  }

  function retry() {
    setError('');
    setLoading(true);
    setReload((value) => value + 1);
  }

  const completed = tasks.filter((task) => task.completed).length;

  return (
    <Container component="main" maxWidth={false} sx={{ maxWidth: 1080, px: { xs: 2.5, sm: 6 } }}>
      <Stack
        component="header"
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ py: { xs: 2.75, sm: 3.75 }, borderBottom: 1, borderColor: 'divider' }}
      >
        <Link
          href="/"
          aria-label="Roxy Star Wars home"
          underline="none"
          color="text.primary"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1.25,
            fontSize: 23,
            fontWeight: 700
          }}
        >
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              width: 36,
              height: 36,
              borderRadius: '11px',
              bgcolor: 'primary.main',
              color: '#dcf299',
              textAlign: 'center',
              lineHeight: '34px',
              fontSize: 27
            }}
          >
            r.
          </Box>
          Roxy Star Wars
        </Link>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: { xs: 9, sm: 11 } }}>
          MERN STARTER / 01
        </Typography>
      </Stack>

      <Box component="section" aria-labelledby="page-title" sx={{ pt: { xs: 5, sm: 8 }, pb: 5 }}>
        <Typography component="p" variant="overline" color="secondary.dark" sx={{ mb: 2 }}>
          A foundation for your next idea
        </Typography>
        <Typography component="h1" variant="h1" id="page-title">
          Start small.
          <br />
          <Box component="span" sx={{ color: 'secondary.main' }}>
            Build something great.
          </Box>
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 490, lineHeight: 1.7, my: 3 }}>
          Your React workspace, connected to an Express API and MongoDB. Add a task below to try the
          full stack.
        </Typography>
        <Stack direction="row" useFlexGap spacing={1} flexWrap="wrap" aria-label="Technology stack">
          {['MongoDB', 'Express', 'React', 'Node.js'].map((name) => (
            <Chip key={name} label={name} variant="outlined" size="small" />
          ))}
        </Stack>
      </Box>

      <Paper
        component="section"
        variant="outlined"
        aria-labelledby="tasks-title"
        sx={{ p: { xs: 2.5, sm: 3.75 }, borderRadius: '18px', boxShadow: '0 8px 30px #17342f04' }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography component="p" variant="overline" color="secondary.dark" sx={{ mb: 0.75 }}>
              Your first collection
            </Typography>
            <Typography component="h2" variant="h2" id="tasks-title">
              The starting list
            </Typography>
          </Box>
          <Chip
            label={`${completed} / ${tasks.length} complete`}
            size="small"
            sx={{ bgcolor: 'secondary.light' }}
          />
        </Stack>

        <Stack
          component="form"
          onSubmit={addTask}
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.25}
        >
          <TextField
            id="task-title"
            label="New task"
            placeholder="What would you like to build?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            required
            disabled={busy || loading}
            autoComplete="off"
            fullWidth
          />
          <Button
            variant="contained"
            type="submit"
            disabled={busy || loading || !title.trim()}
            endIcon={<ArrowOutwardRounded />}
            sx={{ flexShrink: 0, px: 2.5 }}
          >
            Add task
          </Button>
        </Stack>

        {error && (
          <Alert
            severity="error"
            sx={{ mt: 2 }}
            action={
              <Button color="inherit" disabled={busy || loading} onClick={retry}>
                Try again
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        <Box aria-live="polite" aria-busy={loading}>
          {loading ? (
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              justifyContent="center"
              sx={{ py: 5 }}
            >
              <CircularProgress size={20} aria-label="Loading tasks" />
              <Typography variant="body2" color="text.secondary">
                Connecting to your workspace…
              </Typography>
            </Stack>
          ) : tasks.length === 0 ? (
            <Box sx={{ py: 4.5, px: 1, textAlign: 'center' }}>
              <Box
                sx={{
                  display: 'inline-flex',
                  p: 1.25,
                  bgcolor: 'secondary.light',
                  borderRadius: '14px',
                  color: 'secondary.main'
                }}
              >
                <AddRounded fontSize="large" />
              </Box>
              <Typography component="h3" variant="subtitle1" sx={{ mt: 2, mb: 0.75 }}>
                A little room for big ideas.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Your tasks will appear here. Add your first one above.
              </Typography>
            </Box>
          ) : (
            <List disablePadding sx={{ my: 2 }}>
              {tasks.map((task) => (
                <ListItem
                  key={task._id}
                  divider
                  disableGutters
                  sx={{ py: 1.5, pr: 6 }}
                  secondaryAction={
                    <IconButton
                      edge="end"
                      color="error"
                      disabled={busy}
                      aria-label={`Delete ${task.title}`}
                      onClick={() => deleteTask(task)}
                    >
                      <DeleteOutlineRounded />
                    </IconButton>
                  }
                >
                  <FormControlLabel
                    sx={{ m: 0, minWidth: 0 }}
                    control={
                      <Checkbox
                        checked={task.completed}
                        disabled={busy}
                        onChange={() => toggleTask(task)}
                      />
                    }
                    label={
                      <Typography
                        variant="body2"
                        sx={{
                          overflowWrap: 'anywhere',
                          textDecoration: task.completed ? 'line-through' : 'none',
                          color: task.completed ? 'text.secondary' : 'text.primary'
                        }}
                      >
                        {task.title}
                      </Typography>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>

        <Divider />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: 2 }}>
          <SubdirectoryArrowRightRounded fontSize="small" color="secondary" />
          <Typography variant="caption" color="text.secondary">
            Saved in MongoDB. Ready for your next visit.
          </Typography>
        </Stack>
      </Paper>

      <Stack
        component="footer"
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        spacing={1}
        sx={{ py: 3.5 }}
      >
        <Typography variant="caption" color="text.secondary">
          Made to be made your own.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Roxy Star Wars / Development workspace
        </Typography>
      </Stack>
    </Container>
  );
}
