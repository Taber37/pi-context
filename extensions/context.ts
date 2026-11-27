import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installContext } from '../src/pi/controller.mjs';
import { renderContext } from '../src/view/render.mjs';

export default function contextExtension(pi: ExtensionAPI) {
  installContext(pi, renderContext);
}
