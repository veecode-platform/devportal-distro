import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Link as BackstageLink } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';

import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';

import { pendingChangesApiRef, PendingChangesResponse } from '../../api';

export interface PendingChangesButtonProps {
  color?:
    | 'inherit'
    | 'default'
    | 'primary'
    | 'secondary'
    | 'error'
    | 'info'
    | 'success'
    | 'warning';
  size?: 'small' | 'medium' | 'large';
  badgeColor?:
    | 'primary'
    | 'secondary'
    | 'default'
    | 'error'
    | 'info'
    | 'success'
    | 'warning';
  to?: string;
  layout?: CSSProperties;
  pollingIntervalMs?: number;
}

const extractPluginName = (pkg: string): string => {
  const ociIdx = pkg.indexOf('!');
  if (ociIdx !== -1) return pkg.substring(ociIdx + 1);
  const lastSlash = pkg.lastIndexOf('/');
  if (lastSlash !== -1) return pkg.substring(lastSlash + 1);
  return pkg;
};

const pendingMessage = (count: number) =>
  `${count} pending change${count !== 1 ? 's' : ''} will take effect after restart`;

export const PendingChangesButton = ({
  color = 'inherit',
  size = 'small',
  badgeColor = 'warning',
  to = '/marketplace',
  layout,
  pollingIntervalMs = 30000,
}: PendingChangesButtonProps) => {
  const api = useApi(pendingChangesApiRef);
  const [data, setData] = useState<PendingChangesResponse | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const initialFetchDone = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await api.getPendingChanges();
      setData(prev => {
        if (initialFetchDone.current) {
          const prevCount = prev?.count ?? 0;
          if (result.count > prevCount) {
            setSnackbarOpen(true);
          }
        }
        initialFetchDone.current = true;
        return result;
      });
    } catch {
      // silently ignore fetch errors
    }
  }, [api]);

  useEffect(() => {
    fetchData();
    if (pollingIntervalMs > 0) {
      const id = setInterval(fetchData, pollingIntervalMs);
      return () => clearInterval(id);
    }
    return undefined;
  }, [fetchData, pollingIntervalMs]);

  const count = data?.count ?? 0;
  const tooltipText = pendingMessage(count);
  const popoverOpen = Boolean(anchorEl);

  return (
    <>
      {count > 0 && (
        <Box sx={layout}>
          <Tooltip title={popoverOpen ? '' : tooltipText}>
            <div>
              <IconButton
                color={color}
                size={size}
                aria-label={tooltipText}
                onClick={e => setAnchorEl(popoverOpen ? null : e.currentTarget)}
              >
                <Badge badgeContent={count} color={badgeColor} max={99}>
                  <SyncProblemIcon fontSize={size} />
                </Badge>
              </IconButton>
            </div>
          </Tooltip>
          <Popover
            open={popoverOpen}
            anchorEl={anchorEl}
            onClose={() => setAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { width: 360, maxHeight: 400 } } }}
          >
            <Box sx={{ p: 2, pb: 1 }}>
              <Typography variant="subtitle2" color="warning.main">
                {tooltipText}
              </Typography>
            </Box>
            <Divider />
            <List dense disablePadding sx={{ py: 0.5 }}>
              {(data?.pendingInstalls ?? []).map(pkg => (
                <ListItem key={pkg}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <AddCircleOutlineIcon fontSize="small" color="success" />
                  </ListItemIcon>
                  <ListItemText
                    primary={extractPluginName(pkg)}
                    primaryTypographyProps={{
                      variant: 'body2',
                      noWrap: true,
                    }}
                    secondary="Pending install"
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              ))}
              {(data?.pendingRemovals ?? []).map(pkg => (
                <ListItem key={pkg}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <RemoveCircleOutlineIcon fontSize="small" color="error" />
                  </ListItemIcon>
                  <ListItemText
                    primary={extractPluginName(pkg)}
                    primaryTypographyProps={{
                      variant: 'body2',
                      noWrap: true,
                    }}
                    secondary="Pending removal"
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              ))}
            </List>
            <Divider />
            <Box sx={{ p: 1, display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                size="small"
                component={BackstageLink}
                to={to}
                onClick={() => setAnchorEl(null)}
              >
                Go to Marketplace
              </Button>
            </Box>
          </Popover>
        </Box>
      )}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={8000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbarOpen(false)}
          severity="warning"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {tooltipText}
        </Alert>
      </Snackbar>
    </>
  );
};
