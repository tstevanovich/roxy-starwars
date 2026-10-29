import { Button, Stack } from '@mui/material';

import { reviewHref } from './review-navigation.js';

export default function ReviewLinks({ rows = [], currentId, prefix = 'Go to' }) {
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {rows.map((row) => (
        <Button
          component="a"
          key={row.key}
          href={reviewHref(row.target, row.stage, currentId)}
          size="small"
        >
          {prefix} {row.navigationTitle || row.title}
        </Button>
      ))}
    </Stack>
  );
}
