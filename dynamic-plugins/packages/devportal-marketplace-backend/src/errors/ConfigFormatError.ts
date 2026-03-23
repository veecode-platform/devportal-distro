import { CustomErrorBase } from '@backstage/errors';

export class ConfigFormatError extends CustomErrorBase {
  name = 'ConfigFormatError' as const;
}
