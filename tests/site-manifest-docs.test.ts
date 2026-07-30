import { describe, expect, it } from 'vitest';
import { AddonManifest } from '../loader/src/shared/schema.ts';
import { documentedFields, fieldDocs, requiredFields } from '../tools/site/manifest-docs.ts';

/**
 * The whole point of splitting the prose out of the schema: these two have to
 * agree, and a test is what makes that true rather than a promise.
 *
 * A field added to the schema and not documented fails here. So does a documented
 * field the schema no longer has, and so does a required/optional flag that
 * disagrees with what zod actually enforces. Without this the site would quietly
 * describe a manifest format that stopped existing two releases ago.
 */
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

  it('render in schema order, so the table matches the shape', () => {
    expect(fieldDocs(schemaFields).map((one) => one.name)).toEqual(schemaFields);
  });

  it('give every field a non-empty description', () => {
    for (const field of fieldDocs(schemaFields)) {
      expect(field.description.length).toBeGreaterThan(20);
    }
  });

  it('throws rather than rendering a blank cell for an undocumented field', () => {
    expect(() => fieldDocs(['nonesuch'])).toThrow(/no prose for field `nonesuch`/);
  });

  // The id rule is the one fact on that page that costs a player their settings if
  // it is missing, so it is asserted by content rather than only by presence.
  it('states that the id cannot change after publication', () => {
    const [id] = fieldDocs(['id']);
    expect(id?.description).toMatch(/cannot change once published/);
  });

  it('says permissions are a disclosure rather than a boundary', () => {
    expect(fieldDocs(['permissions'])[0]?.description).toMatch(/disclosure, not a boundary/);
  });
});
