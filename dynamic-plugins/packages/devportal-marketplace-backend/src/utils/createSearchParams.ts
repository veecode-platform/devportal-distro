import { Request } from 'express';

export const createSearchParams = (req: Request): URLSearchParams => {
  const searchParams = new URLSearchParams();

  Object.entries(req.query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => {
        if (typeof v === 'string') searchParams.append(key, v);
      });
    } else if (typeof value === 'string') {
      searchParams.append(key, value);
    }
  });

  return searchParams;
};
