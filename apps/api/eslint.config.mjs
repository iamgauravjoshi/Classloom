import { nest } from '@classloom/config/eslint/nest';

export default [...nest(import.meta.dirname), { ignores: ['src/generated/**', 'dist/**'] }];
