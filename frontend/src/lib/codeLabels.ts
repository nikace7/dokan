/** Labels for codes the server sends, in the shop's language. */
import i18n from 'i18next';

const key = (code: string) => code.split('.').join('_');

/** `sale.create` → its Nepali name, or the server's English name. */
export function permissionName(code: string, name: string): string {
  return i18n.t(`permissionNames.${key(code)}`, { defaultValue: name });
}

/** `sale.share` → "Bill shared"; an action not listed shows its code. */
export function auditActionLabel(action: string): string {
  return i18n.t(`audit.actions.${key(action)}`, { defaultValue: action });
}
