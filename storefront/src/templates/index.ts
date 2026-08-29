import type { ComponentType } from 'react';

import type { SiteInfo } from '../lib/api';
import { AuroraTemplate } from './aurora/AuroraTemplate';
import { BazaarTemplate } from './bazaar/BazaarTemplate';

export interface TemplateProps {
  site: SiteInfo;
}

export const TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  aurora: AuroraTemplate,
  bazaar: BazaarTemplate,
};

export const DEFAULT_TEMPLATE = 'aurora';

export function resolveTemplate(key: string): ComponentType<TemplateProps> {
  return TEMPLATES[key] ?? TEMPLATES[DEFAULT_TEMPLATE];
}
