// Metaphor registry — all built-in metaphors auto-register on import
import { registerMetaphor } from '../metaphor.js';
import { golf } from './golf.js';
import { tennis } from './tennis.js';
import { baseball } from './baseball.js';
import { gaming } from './gaming.js';
import { dnd } from './dnd.js';
import { matrix } from './matrix.js';
import { agile } from './agile.js';

// Register all built-in metaphors
registerMetaphor(golf);
registerMetaphor(tennis);
registerMetaphor(baseball);
registerMetaphor(gaming);
registerMetaphor(dnd);
registerMetaphor(matrix);
registerMetaphor(agile);

export { golf, tennis, baseball, gaming, dnd, matrix, agile };
