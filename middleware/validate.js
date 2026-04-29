import { ZodError } from 'zod';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const result = schema.parse(req[source]);
      req[source] = result; // replace with coerced/stripped values
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues ?? err.errors ?? [];
        return res.status(400).json({
          message: 'Validation failed.',
          errors: issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
        });
      }
      next(err);
    }
  };
}
