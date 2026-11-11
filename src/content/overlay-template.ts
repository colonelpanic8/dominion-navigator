export const OVERLAY_HTML = `
  <style>
    :host { all: initial; }
    .panel {
      position: fixed;
      right: 12px;
      top: 72px;
      z-index: 2147483647;
      width: 300px;
      max-height: calc(100vh - 96px);
      overflow: auto;
      box-sizing: border-box;
      padding: 10px;
      border: 1px solid rgba(255,255,255,.32);
      background: rgba(15, 18, 22, .92);
      color: #f5f5f5;
      font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 10px 28px rgba(0,0,0,.35);
      border-radius: 6px;
    }
    .panel.collapsed {
      right: 0;
      width: auto;
      max-height: none;
      overflow: visible;
      padding: 0;
      border-right: 0;
      border-radius: 6px 0 0 6px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .panel.collapsed .header {
      margin-bottom: 0;
    }
    .panel.collapsed .title,
    .panel.collapsed #refresh {
      display: none;
    }
    .panel.collapsed #toggle {
      width: 32px;
      height: 32px;
      min-width: 32px;
      border-width: 0 0 0 1px;
      border-radius: 6px 0 0 6px;
      background: rgba(15, 18, 22, .94);
      box-shadow: 0 6px 18px rgba(0,0,0,.32);
    }
    .title {
      font-weight: 700;
      font-size: 13px;
    }
    button {
      all: unset;
      cursor: pointer;
      box-sizing: border-box;
      min-width: 26px;
      height: 24px;
      display: inline-grid;
      place-items: center;
      border: 1px solid rgba(255,255,255,.28);
      border-radius: 4px;
      background: rgba(255,255,255,.08);
      color: #fff;
      font-weight: 700;
    }
    .text-button {
      min-width: 0;
      width: 100%;
      padding: 0 8px;
      justify-content: center;
      font-size: 12px;
    }
    button:hover { background: rgba(255,255,255,.16); }
    button:disabled {
      cursor: default;
      opacity: .45;
    }
    button:disabled:hover { background: rgba(255,255,255,.08); }
    .setting {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      color: #dce2ea;
    }
    .setting input {
      accent-color: #8fb8ff;
      width: 14px;
      height: 14px;
      margin: 0;
    }
    .meta {
      color: #b9c0c9;
      margin-bottom: 8px;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
      margin-bottom: 8px;
    }
    .zone {
      border-top: 1px solid rgba(255,255,255,.14);
      padding: 7px 0;
    }
    .zone-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-weight: 650;
      margin-bottom: 4px;
    }
    .title-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .cards {
      color: #dce2ea;
      overflow-wrap: anywhere;
    }
    .muted { color: #8f99a6; }
    .moves {
      margin-top: 8px;
      border-top: 1px solid rgba(255,255,255,.18);
      padding-top: 8px;
    }
    .knowledge {
      margin-top: 8px;
      border-top: 1px solid rgba(255,255,255,.18);
      padding-top: 8px;
    }
    .player {
      padding: 7px 0;
      border-top: 1px solid rgba(255,255,255,.12);
    }
    .player:first-of-type { border-top: 0; }
    .player-name {
      font-weight: 650;
      margin-bottom: 4px;
    }
    .line {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #dce2ea;
      margin-top: 3px;
    }
    .line-stacked {
      display: block;
    }
    .line span:first-child {
      color: #aeb8c5;
      white-space: nowrap;
    }
    .line-stacked span:first-child {
      display: block;
      white-space: normal;
    }
    .line-stacked b {
      display: block;
      margin-top: 2px;
      text-align: left;
    }
    .move {
      margin-top: 5px;
      color: #dce2ea;
    }
    .hidden { display: none; }
  </style>
  <div class="panel collapsed">
    <div class="header">
      <div class="title">Dominion Navigator</div>
      <div>
        <button id="refresh" title="Refresh snapshot">↻</button>
        <button id="toggle" title="Open navigator">+</button>
      </div>
    </div>
    <div id="body" class="hidden">
      <div class="meta" id="meta">Waiting for game model...</div>
      <label class="setting" title="Allow visible zone evidence to identify anonymous owned cards.">
        <span>Identity repair</span>
        <input id="identity-repair" type="checkbox" />
      </label>
      <div class="actions">
        <button id="show-deck" class="text-button" title="Open your draw pile knowledge in a Dominion card window">Open Draw Window</button>
      </div>
      <div class="knowledge">
        <div class="zone-title"><span>Knowledge Model</span></div>
        <div id="knowledge"><span class="muted">No deck knowledge yet.</span></div>
      </div>
      <div id="zones"></div>
      <div class="moves">
        <div class="zone-title"><span>Recent Moves</span></div>
        <div id="moves"><span class="muted">No moves captured yet.</span></div>
      </div>
    </div>
  </div>
`;
