/*
 * Copyright The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Fragment, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ItemCardGrid, Link } from '@backstage/core-components';
import { useRouteRef } from '@backstage/core-plugin-api';

import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';

import { ExtensionsPlugin } from '@red-hat-developer-hub/backstage-plugin-extensions-common';

import { usePluginStatus, MarketplaceStatus } from '../hooks/usePluginStatus';
import { usePluginConfigurationPermissions } from '../hooks/usePluginConfigurationPermissions';
import { Permission } from '../types';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import { useEnablePlugin } from '../hooks/useEnablePlugin';
import { useQueryClient } from '@tanstack/react-query';

import { rootRouteRef, pluginRouteRef } from '../routes';
import { BadgeTriange } from './Badges';
import { CategoryLinkButton } from './CategoryLinkButton';
import { PluginIcon } from './PluginIcon';
import { useTranslation } from '../hooks/useTranslation';

export interface PluginCardSkeletonProps {
  animation?: 'pulse' | 'wave' | false;
}

export const PluginCardGrid = ItemCardGrid;

const statusConfig: Record<MarketplaceStatus, {
  label: string;
  color: 'success' | 'warning' | 'error' | 'default' | 'info';
}> = {
  'available': { label: '', color: 'default' },
  'built-in': { label: 'Built-in', color: 'default' },
  'installed': { label: 'Installed', color: 'success' },
  'disabled': { label: 'Disabled', color: 'error' },
  'pending-install': { label: 'Pending install', color: 'warning' },
  'pending-removal': { label: 'Pending removal', color: 'warning' },
};

const PluginStatusBadge = ({ status }: { status: MarketplaceStatus }) => {
  const config = statusConfig[status];
  if (!config.label) return null;
  return (
    <Chip
      label={config.label}
      color={config.color}
      size="small"
      variant="outlined"
    />
  );
};

export const PluginCardSkeleton = ({ animation }: PluginCardSkeletonProps) => (
  <Card variant="outlined">
    <CardContent>
      <Stack spacing={2}>
        <Stack direction="row" spacing={2}>
          <Skeleton
            variant="rectangular"
            animation={animation}
            sx={{ width: '80px', height: '80px', mr: 2 }}
          />
          <Stack spacing={0.5}>
            <Skeleton animation={animation}>
              <Typography variant="subtitle1">Entry name</Typography>
            </Skeleton>
            <Skeleton animation={animation}>
              <Typography variant="subtitle2">by someone</Typography>
            </Skeleton>
            <Skeleton animation={animation}>
              <Typography variant="subtitle2">Category</Typography>
            </Skeleton>
          </Stack>
        </Stack>
        <div>
          <Skeleton animation={animation} />
          <Skeleton animation={animation} />
          <Skeleton animation={animation} />
        </div>
      </Stack>
    </CardContent>
    <CardActions sx={{ p: 2, justifyContent: 'flex-start' }}>
      <Skeleton animation={animation} style={{ width: 50 }} />
    </CardActions>
  </Card>
);

// orange: #EC7A08

// TODO: add link around card
export const PluginCard = ({ plugin }: { plugin: ExtensionsPlugin }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const getIndexPath = useRouteRef(rootRouteRef);
  const getPluginPath = useRouteRef(pluginRouteRef);

  const pluginPath = `${getPluginPath({
    namespace: plugin.metadata.namespace!,
    name: plugin.metadata.name,
  })}${searchParams.size > 0 ? '?' : ''}${searchParams}`;

  //  + (searchParams.size > 0 ? `?${searchParams.toString()}` : '')

  const withFilter = (name: string, value: string) =>
    `${getIndexPath()}?filter=${encodeURIComponent(name)}=${encodeURIComponent(
      value,
    )}`;

  const status = usePluginStatus(plugin);
  const permissions = usePluginConfigurationPermissions(
    plugin.metadata.namespace!,
    plugin.metadata.name,
  );
  const canWrite = permissions.data?.write === Permission.ALLOW;
  const queryClient = useQueryClient();
  const enableMutation = useEnablePlugin(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const invalidateQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pending-changes'] });
    queryClient.invalidateQueries({ queryKey: ['plugins'] });
  }, [queryClient]);

  const handleInstall = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmAction({
      title: 'Install plugin',
      confirmLabel: 'Install',
      onConfirm: () => {
        enableMutation.mutate(
          {
            namespace: plugin.metadata.namespace!,
            name: plugin.metadata.name,
            disabled: false,
          },
          { onSuccess: invalidateQueries },
        );
        setConfirmAction(null);
      },
    });
  }, [plugin, enableMutation, invalidateQueries]);

  const handleUninstall = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmAction({
      title: 'Uninstall plugin',
      confirmLabel: 'Uninstall',
      onConfirm: () => {
        enableMutation.mutate(
          {
            namespace: plugin.metadata.namespace!,
            name: plugin.metadata.name,
            disabled: true,
          },
          { onSuccess: invalidateQueries },
        );
        setConfirmAction(null);
      },
    });
  }, [plugin, enableMutation, invalidateQueries]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const enabling = status === 'disabled';
    setConfirmAction({
      title: enabling ? 'Enable plugin' : 'Disable plugin',
      confirmLabel: enabling ? 'Enable' : 'Disable',
      onConfirm: () => {
        enableMutation.mutate(
          {
            namespace: plugin.metadata.namespace!,
            name: plugin.metadata.name,
            disabled: !enabling,
          },
          { onSuccess: invalidateQueries },
        );
        setConfirmAction(null);
      },
    });
  }, [plugin, status, enableMutation, invalidateQueries]);

  return (
    <Card
      variant="outlined"
      sx={{
        position: 'relative',
        '&:hover': { backgroundColor: 'background.default', cursor: 'pointer' },
      }}
      onClick={() => navigate(pluginPath)}
    >
      <BadgeTriange plugin={plugin} />
      <CardContent sx={{ backgroundColor: 'transparent' }}>
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ minHeight: '120px', alignItems: 'center' }}
          >
            <PluginIcon plugin={plugin} size={80} />
            <Stack spacing={0.5} sx={{ justifyContent: 'center' }}>
              <Typography variant="subtitle1" style={{ fontWeight: '500' }}>
                {plugin.metadata.title ?? plugin.metadata.name}
              </Typography>

              {plugin.spec?.authors ? (
                <Typography
                  variant="subtitle2"
                  style={{ fontWeight: 'normal' }}
                >
                  {plugin.spec.authors.map((author, index) => (
                    <Fragment key={author.name}>
                      {index > 0 ? t('common.comma') : t('common.by')}
                      <Link
                        key={author.name}
                        to={withFilter('author', author.name)}
                        color="primary"
                        onClick={e => e.stopPropagation()}
                      >
                        {author.name}
                      </Link>
                    </Fragment>
                  ))}
                </Typography>
              ) : null}

              {plugin.spec?.categories && plugin.spec.categories.length > 0 ? (
                <Typography
                  variant="subtitle2"
                  style={{ fontWeight: 'normal' }}
                >
                  <CategoryLinkButton
                    categoryName={plugin.spec.categories[0]}
                    to={withFilter('category', plugin.spec.categories[0])}
                    onClick={e => e.stopPropagation()}
                  />
                </Typography>
              ) : null}
            </Stack>
          </Stack>

          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 'normal',
              fontStyle: plugin.metadata.description ? undefined : 'italic',
            }}
          >
            {plugin.metadata.description ?? t('common.noDescriptionAvailable')}
          </Typography>
        </Stack>
      </CardContent>
      <CardActions
        sx={{
          pl: 2,
          pr: 2,
          pb: 2,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Link to={pluginPath} onClick={e => e.stopPropagation()}>
          {t('common.readMore')}
        </Link>
        <Stack direction="row" alignItems="center" spacing={1}>
          <PluginStatusBadge status={status} />
          {canWrite && status === 'available' && (
            <Button size="small" variant="outlined" onClick={handleInstall}>
              Install
            </Button>
          )}
          {canWrite && status === 'installed' && (
            <Button size="small" color="error" onClick={handleUninstall}>
              Uninstall
            </Button>
          )}
          {canWrite && status === 'disabled' && (
            <Button size="small" color="primary" onClick={handleToggle}>
              Enable
            </Button>
          )}
          {canWrite && status === 'built-in' && (
            <Button size="small" color="error" onClick={handleToggle}>
              Disable
            </Button>
          )}
        </Stack>
      </CardActions>
      <ConfirmActionDialog
        open={confirmAction !== null}
        title={confirmAction?.title ?? ''}
        confirmLabel={confirmAction?.confirmLabel}
        onConfirm={confirmAction?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmAction(null)}
      />
    </Card>
  );
};
