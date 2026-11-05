import ExpandLessOutlined from '@mui/icons-material/ExpandLessOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import { Box, Button, Stack, Typography } from '@mui/material';
import type * as React from 'react';
import { useEffect, useState } from 'react';

import { focusSection } from './review-navigation.ts';

export default function ShotDisclosure({
  storageKey,
  anchorId,
  title,
  index,
  duration,
  status,
  children
}: {
  storageKey: string;
  anchorId: string;
  title: string;
  index: number;
  duration: number;
  status?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== 'false';
    } catch {
      return true;
    }
  });
  const contentId = `${anchorId}-content`;
  function changeExpansion(open) {
    setExpanded(open);
    try {
      localStorage.setItem(storageKey, String(open));
    } catch {
      /* Keep this tab's choice when storage is unavailable. */
    }
  }
  useEffect(() => {
    let frame;
    const follow = () => {
      const anchor = window.location.hash.slice(1);
      const destination = anchor && document.getElementById(anchor);
      if (!destination || !document.getElementById(anchorId)?.contains(destination)) return;
      setExpanded(true);
      frame = requestAnimationFrame(() => focusSection(anchor));
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
      cancelAnimationFrame(frame);
    };
  }, [anchorId]);
  return (
    <Box
      component="details"
      data-shot-panel
      open={expanded}
      onToggle={(event) => changeExpansion(event.currentTarget.open)}
    >
      <Box
        component="summary"
        aria-label={`Shot ${index + 1}: ${title} - ${expanded ? 'Collapse shot' : 'Expand shot'}`}
        sx={{
          cursor: 'pointer',
          listStyle: 'none',
          borderRadius: 1,
          '&::-webkit-details-marker': { display: 'none' },
          '&:focus-visible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: 4
          }
        }}
      >
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}
        >
          <Box sx={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography variant="overline">
              Shot {index + 1} · {duration}s
            </Typography>
            <Typography variant="h3" component="h3">
              {title}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            aria-expanded={expanded}
            aria-controls={contentId}
            startIcon={expanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
            sx={{ flexShrink: 0 }}
            onClick={(event) => {
              event.preventDefault();
              changeExpansion(!expanded);
            }}
          >
            {expanded ? 'Collapse shot' : 'Expand shot'}
          </Button>
        </Stack>
        {status}
      </Box>
      <Box id={contentId} sx={{ mt: 2 }}>
        {children}
      </Box>
    </Box>
  );
}
