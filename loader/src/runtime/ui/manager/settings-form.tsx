// Settings, rendered from the manifest schema.
//
// Pure render over a values object plus the declarations, so the manager can
// draw an addon's settings without running it. That is what makes settings
// editable for a DISABLED addon, which is the case that matters: an addon that
// misbehaves is one a player disables first and reconfigures second.
//
// Every control is committed on change rather than behind a Save button. The
// store persists per field and a running addon sees each edit through its own
// change event, so a Save would be a second concept for no extra safety.

import type { SettingDecl } from '../../../shared/schema.ts';
import type { SettingValue, SettingValues } from '../../settings/values.ts';
import { ErrorNote } from './error-note.tsx';
import { fieldId } from './fields.ts';
import { UI_TEXT } from './strings.ts';

interface FieldProps {
  decl: SettingDecl;
  value: SettingValue;
  onChange: (id: string, value: SettingValue) => void;
}

function BooleanField(props: FieldProps & { domId: string }) {
  return (
    <label className="woc-field woc-field-inline" htmlFor={props.domId}>
      <input
        id={props.domId}
        type="checkbox"
        checked={props.value === true}
        onChange={(event) => {
          props.onChange(props.decl.id, (event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span className="woc-field-label">{props.decl.label}</span>
    </label>
  );
}

function NumberField(props: FieldProps & { domId: string }) {
  const { decl } = props;
  if (decl.type !== 'number') {
    return null;
  }
  return (
    <div className="woc-field">
      <label className="woc-field-label" htmlFor={props.domId}>
        {decl.label}
      </label>
      <input
        id={props.domId}
        type="number"
        className="woc-input"
        value={String(props.value)}
        min={decl.min}
        max={decl.max}
        onChange={(event) => {
          const raw = (event.currentTarget as HTMLInputElement).valueAsNumber;
          // A cleared field reads as NaN, which the store would reject. Holding
          // the previous value keeps the field usable while it is being retyped.
          if (Number.isFinite(raw)) {
            props.onChange(decl.id, raw);
          }
        }}
      />
    </div>
  );
}

function SelectField(props: FieldProps & { domId: string }) {
  const { decl } = props;
  if (decl.type !== 'select') {
    return null;
  }
  return (
    <div className="woc-field">
      <label className="woc-field-label" htmlFor={props.domId}>
        {decl.label}
      </label>
      <select
        id={props.domId}
        className="woc-input"
        value={String(props.value)}
        onChange={(event) => {
          props.onChange(decl.id, (event.currentTarget as HTMLSelectElement).value);
        }}
      >
        {decl.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function StringField(props: FieldProps & { domId: string }) {
  return (
    <div className="woc-field">
      <label className="woc-field-label" htmlFor={props.domId}>
        {props.decl.label}
      </label>
      <input
        id={props.domId}
        type="text"
        className="woc-input"
        value={String(props.value)}
        onChange={(event) => {
          props.onChange(props.decl.id, (event.currentTarget as HTMLInputElement).value);
        }}
      />
    </div>
  );
}

function Field(props: FieldProps & { domId: string }) {
  if (props.decl.type === 'boolean') {
    return <BooleanField {...props} />;
  }
  if (props.decl.type === 'number') {
    return <NumberField {...props} />;
  }
  if (props.decl.type === 'select') {
    return <SelectField {...props} />;
  }
  return <StringField {...props} />;
}

interface SettingsFormProps {
  fqid: string;
  decls: readonly SettingDecl[];
  values: SettingValues;
  onChange: (id: string, value: SettingValue) => void;
  /** Set when the last write failed, so a rejected edit is not silent. */
  error: string | null;
}

export function SettingsForm(props: SettingsFormProps) {
  if (props.decls.length === 0) {
    return <p className="woc-note">{UI_TEXT.settingsNone}</p>;
  }
  return (
    <>
      <ErrorNote error={props.error} />
      <div className="woc-form">
        {props.decls.map((decl) => (
          <Field
            key={decl.id}
            decl={decl}
            domId={fieldId(props.fqid, decl.id)}
            value={props.values[decl.id] ?? decl.default}
            onChange={props.onChange}
          />
        ))}
      </div>
    </>
  );
}
