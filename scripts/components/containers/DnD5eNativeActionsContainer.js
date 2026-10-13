import { BG3Component } from '/modules/bg3-hud-core/scripts/components/BG3Component.js';
import { createLogger } from '/modules/bg3-hud-core/scripts/utils/logger.js';

const log = createLogger('bg3-hud-dnd5e');
const MODULE_ID = 'bg3-hud-dnd5e';

const ACTIONS = [
  { key: 'dash', icon: 'fas fa-running' },
  { key: 'disengage', icon: 'fas fa-sign-out-alt' },
  { key: 'dodge', icon: 'fas fa-shield-alt' },
  { key: 'help', icon: 'fas fa-handshake' },
  { key: 'hide', icon: 'fas fa-eye-slash', skill: 'ste' },
  { key: 'ready', icon: 'fas fa-hourglass-half' }
];

function escapeHtml(value) {
  const text = String(value ?? '');
  if (foundry.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
  return text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

/**
 * Lightweight generic D&D actions for the BG3 HUD.
 *
 * This deliberately avoids CPR / Midi-QoL. It uses D&D5e's own rule references
 * and native Actor roll APIs, while the BG3 HUD tracks the Action filter as used.
 */
export class DnD5eNativeActionsContainer extends BG3Component {
  constructor(options = {}) {
    super(options);
    this.actor = options.actor || null;
    this.token = options.token || null;
  }

  get visible() {
    if (!this.actor) return false;
    return game.settings.get(MODULE_ID, 'enableNativeGenericActions');
  }

  async render() {
    if (!this.element) {
      this.element = this.createElement('div', ['bg3-native-actions-container']);
      this.element.dataset.bg3Ui = 'true';
    }

    this.element.replaceChildren();

    if (!this.visible) {
      this.element.style.display = 'none';
      return this.element;
    }

    this.element.style.display = 'grid';

    for (const action of ACTIONS) {
      const button = this.createElement('button', ['bg3-native-action-btn']);
      button.type = 'button';
      button.dataset.action = action.key;
      button.dataset.bg3Ui = 'true';

      const label = game.i18n.localize(`${MODULE_ID}.NativeActions.${action.key}.Label`);
      button.setAttribute('aria-label', label);
      button.dataset.tooltip = game.i18n.localize(`${MODULE_ID}.NativeActions.${action.key}.Tooltip`);
      button.dataset.tooltipDirection = 'LEFT';

      const icon = this.createElement('i', action.icon.split(' '));
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);

      this.addEventListener(button, 'click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this._useAction(action, event);
      });

      this.addEventListener(button, 'contextmenu', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this._openRule(action);
      });

      this.element.appendChild(button);
    }

    return this.element;
  }

  async _useAction(action, event) {
    try {
      if (!this.actor) return;

      const label = game.i18n.localize(`${MODULE_ID}.NativeActions.${action.key}.Label`);
      const ruleUuid = CONFIG.DND5E?.rules?.[action.key] ?? null;
      const TextEditor = foundry.applications.ux.TextEditor.implementation;

      let ruleLink = `<strong>${escapeHtml(label)}</strong>`;
      if (ruleUuid) {
        ruleLink = await TextEditor.enrichHTML(
          `@UUID[${ruleUuid}]{${escapeHtml(label)}}`,
          { relativeTo: this.actor }
        );
      }

      const targets = Array.from(game.user?.targets ?? [])
        .map(t => t?.name)
        .filter(Boolean);

      const targetLine = targets.length
        ? `<div class="bg3-native-action-targets"><strong>${game.i18n.localize(`${MODULE_ID}.NativeActions.Targets`)}:</strong> ${targets.map(escapeHtml).join(', ')}</div>`
        : '';

      const content = `
        <div class="bg3-native-action-chat">
          <div class="bg3-native-action-chat-title">
            <i class="${escapeHtml(action.icon)}"></i>
            <strong>${escapeHtml(this.actor.name)}</strong> — ${ruleLink}
          </div>
          ${targetLine}
        </div>
      `;

      const speaker = ChatMessage.getSpeaker({
        actor: this.actor,
        token: this.token?.document ?? this.token ?? undefined
      });

      await ChatMessage.create({ speaker, content });
      this._markActionUsed();

      // Hide is the only one of these actions that normally calls for a native
      // skill roll in the 2024 rules. Use D&D5e's own actor API so RSR and other
      // roll presentation modules can still observe the normal system roll.
      if (action.skill && typeof this.actor.rollSkill === 'function') {
        await this.actor.rollSkill({ skill: action.skill, event });
      }
    } catch (error) {
      log.error(`Native action failed: ${action.key}`, error);
      ui.notifications.error(
        game.i18n.format(`${MODULE_ID}.Notifications.NativeActionError`, {
          action: game.i18n.localize(`${MODULE_ID}.NativeActions.${action.key}.Label`)
        })
      );
    }
  }

  _markActionUsed() {
    const filters = ui.BG3HUD_APP?.components?.filters;
    if (!filters || typeof filters.getAllFilterButtons !== 'function') return;

    const actionFilter = filters.getAllFilterButtons()
      .find(button => button?.data?.id === 'action');

    if (!actionFilter) return;
    if (filters.used?.includes(actionFilter)) return;

    filters.used = actionFilter;
  }

  async _openRule(action) {
    try {
      const uuid = CONFIG.DND5E?.rules?.[action.key];
      if (!uuid) return;

      const page = await fromUuid(uuid);
      if (!page) return;

      if (page.sheet?.render) {
        page.sheet.render(true);
        return;
      }

      if (page.parent?.sheet?.render) {
        page.parent.sheet.render(true, { pageId: page.id });
      }
    } catch (error) {
      log.error(`Failed to open native action rule: ${action.key}`, error);
    }
  }

  async update() {
    if (!this.element) return this.render();
    this.element.style.display = this.visible ? 'grid' : 'none';
  }

  destroy() {
    if (this.element) this.element.replaceChildren();
    super.destroy();
  }
}
