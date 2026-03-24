import { CustomErrorBase } from '@backstage/errors';

export const InstallationInitErrorReason = {
  FILE_CONFIG_VALUE_MISSING: 'FILE_CONFIG_VALUE_MISSING',
  FILE_NOT_EXISTS: 'FILE_NOT_EXISTS',
  INVALID_CONFIG: 'INVALID_CONFIG',
  UNKNOWN: 'UNKNOWN',
} as const;

export type InstallationInitErrorReasonKeys =
  (typeof InstallationInitErrorReason)[keyof typeof InstallationInitErrorReason];

export class InstallationInitError extends CustomErrorBase {
  name = 'InstallationInitError' as const;
  readonly statusCode: number = 500;

  constructor(
    public reason: InstallationInitErrorReasonKeys,
    message: string,
    public cause?: Error,
  ) {
    super(message, cause);
  }
}
