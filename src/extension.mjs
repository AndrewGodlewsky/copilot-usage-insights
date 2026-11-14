import { createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { registerCanvas } from './node/canvas.mjs';

const extension = await registerCanvas({ createCanvas, joinSession });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await extension.dispose();
  process.exit(0);
});
