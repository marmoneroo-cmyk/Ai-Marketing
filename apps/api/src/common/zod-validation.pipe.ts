import {
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { z, ZodSchema, ZodError } from 'zod';
import { AppError } from '@brandpilot/core';

/**
 * Static shape of a metatype class produced by `zodSchemaClass`. The `zodSchema`
 * field is how a route-parameter class advertises what to validate against.
 */
interface ZodSchemaCarrier {
  zodSchema?: ZodSchema;
}

/** Safely read the Zod schema attached to a route parameter's metatype. */
function schemaFromMetatype(metatype: unknown): ZodSchema | undefined {
  if (typeof metatype !== 'function') return undefined;
  return (metatype as unknown as ZodSchemaCarrier).zodSchema;
}

/**
 * Global validation pipe. When a handler parameter carries a Zod schema (via
 * the param decorators below), the raw value is parsed and replaced with the
 * validated, typed result. Parameters without a schema pass through untouched
 * so DI-provided args are never disturbed.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = schemaFromMetatype(metadata.metatype);
    if (!schema) return value;

    try {
      return schema.parse(value);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        throw new AppError('validation_error', 'Request validation failed', error.issues);
      }
      throw error;
    }
  }
}

/**
 * Build a metatype class that carries a Zod schema. Extend it to declare a DTO
 * parameter class; the global pipe reads the static schema and validates the
 * incoming value against it, replacing the argument with the parsed result.
 * Instances are typed as the inferred DTO so handlers can use `body` directly.
 *
 * @example
 *   const dtoSchema = z.object({ email: z.string().email() });
 *   class CreateBody extends zodSchemaClass(dtoSchema) {}
 *   // ...
 *   \@Post() create(\@Body() body: CreateBody) {}
 */
export function zodSchemaClass<T extends ZodSchema>(
  schema: T,
): { new (): z.infer<T>; zodSchema: T } {
  class SchemaCarrier {
    static zodSchema = schema;
  }
  return SchemaCarrier as unknown as { new (): z.infer<T>; zodSchema: T };
}
