import { describe, expect, it } from 'vitest';
import { AddonManifest } from '../loader/src/shared/schema.ts';
import { documentedFields, fieldDocs, requiredFields } from '../tools/site/manifest-docs.ts';

/** The site's manifest field docs must match the zod schema's fields and required flags. */
const schemaFields = Object.keys(AddonManifest.shape);

const schemaRequired = Object.entries(AddonManifest.shape)
  .filter(([, field]) => !field.safeParse(undefined).success)
  .map(([name]) => name);

describe('the manifest field docs and the schema', () => {
  it('document exactly the fields the schema has', () => {
    expect([...documentedFields()].sort()).toEqual([...schemaFields].sort());
  });

  it('agree on which fields are required', () => {
    expect([...requiredFields()].sort()).toEqual([...schemaRequired].sort());
  });

  it('render in schema order', () => {
    expect(fieldDocs(schemaFields).map((one) => one.name)).toEqual(schemaFields);
  });

  it('give every field a non-empty description', () => {
    for (const field of fieldDocs(schemaFields)) {
      expect(field.description.length).toBeGreaterThan(20);
    }
  });

  it('throws on an undocumented field', () => {
    expect(() => fieldDocs(['nonesuch'])).toThrow(/no prose for field `nonesuch`/);
  });

  // Asserted by content: a missing id rule costs players their settings.
  it('states that the id cannot change after publication', () => {
    const [id] = fieldDocs(['id']);
    expect(id?.description).toMatch(/cannot change once published/);
  });

  it('says permissions are a disclosure rather than a boundary', () => {
    expect(fieldDocs(['permissions'])[0]?.description).toMatch(/disclosure, not a boundary/);
  });
});
