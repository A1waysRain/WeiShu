// Native connection dialog: available only inside the Android WebView.
import { html, Button } from './components.js';
import { t } from '../../../shared/i18n.js';

export function AndroidConnectButton() {
  if (typeof globalThis.StrongholdAndroid?.connectToHost !== 'function') return null;
  return html`<${Button} variant="secondary" size="sm" icon="users" class="android-connect"
    onClick=${() => globalThis.StrongholdAndroid.connectToHost()}>${t('应用内联机')}<//>`;
}
