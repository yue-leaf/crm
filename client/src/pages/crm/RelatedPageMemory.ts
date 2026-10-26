import { createContext } from 'react';
import type { RelatedPosition } from '@shared/crm-navigation';

// Owned by the current CRM page, never persisted or shared between signed-in sessions.
export const RelatedPageMemory = createContext<Map<string, RelatedPosition> | null>(null);
