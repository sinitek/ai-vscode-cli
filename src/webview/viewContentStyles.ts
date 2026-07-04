import { BASE_STYLES } from './viewContentStyles/base';
import { HEADER_TABS_STYLES } from './viewContentStyles/headerTabs';
import { CHAT_AREA_STYLES } from './viewContentStyles/chatArea';
import { MESSAGE_BLOCK_STYLES } from './viewContentStyles/messages';
import { MARKDOWN_STYLES } from './viewContentStyles/markdown';
import { SYSTEM_TRACE_STYLES } from './viewContentStyles/systemTrace';
import { TYPING_STATUS_STYLES } from './viewContentStyles/typingStatus';
import { INPUT_CONTROLS_STYLES } from './viewContentStyles/inputControls';
import { OVERLAYS_MODALS_STYLES } from './viewContentStyles/overlaysModals';
import { TOAST_MISC_STYLES } from './viewContentStyles/toastMisc';
import { TASKLIST_STYLES } from './viewContentStyles/tasklist';

export const WEBVIEW_STYLES = [
  BASE_STYLES,
  HEADER_TABS_STYLES,
  CHAT_AREA_STYLES,
  MESSAGE_BLOCK_STYLES,
  MARKDOWN_STYLES,
  SYSTEM_TRACE_STYLES,
  TYPING_STATUS_STYLES,
  INPUT_CONTROLS_STYLES,
  OVERLAYS_MODALS_STYLES,
  TOAST_MISC_STYLES,
  TASKLIST_STYLES
].join('');
