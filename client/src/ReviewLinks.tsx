import { Button, Stack } from '@mui/material';

import type * as Studio from '../../shared/types.ts';
import { focusSection, reviewHref } from './review-navigation.ts';

export default function ReviewLinks({
  rows = [],
  currentId,
  prefix = 'Go to'
}: {
  rows?: Studio.ReviewLink[];
  currentId?: string;
  prefix?: string;
}) {
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {rows.map((row) => (
        <Button
          component="a"
          key={row.key}
          href={row.navigationHref || reviewHref(row.target, row.stage, currentId)}
          onClick={() => {
            const href = row.navigationHref || reviewHref(row.target, row.stage, currentId);
            if (href.startsWith('#')) focusSection(href.slice(1));
          }}
          size="small"
        >
          {prefix} {row.navigationTitle || row.title}
        </Button>
      ))}
    </Stack>
  );
}
