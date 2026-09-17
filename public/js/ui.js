/* ============================================================
   ui.js — shared modal dialogs (mobile-friendly replacements
   for prompt() / confirm())
   ============================================================ */

function _ensureModal() {
    let modal = document.getElementById('ui-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'ui-modal';
    modal.className = 'ui-modal hidden';
    modal.innerHTML = `
        <div class="ui-modal-box">
            <p id="ui-modal-msg"></p>
            <input id="ui-modal-input" type="text" class="hidden" autocomplete="off">
            <div class="btn-group">
                <button id="ui-modal-ok" class="btn btn-primary">OK</button>
                <button id="ui-modal-cancel" class="btn btn-secondary">Cancel</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
}

function _openModal(message, withInput, defaultValue) {
    return new Promise(resolve => {
        const modal = _ensureModal();
        const msg = document.getElementById('ui-modal-msg');
        const input = document.getElementById('ui-modal-input');
        const okBtn = document.getElementById('ui-modal-ok');
        const cancelBtn = document.getElementById('ui-modal-cancel');

        msg.textContent = message;
        input.classList.toggle('hidden', !withInput);
        input.value = defaultValue != null ? defaultValue : '';
        modal.classList.remove('hidden');
        if (withInput) setTimeout(() => { input.focus(); input.select(); }, 50);

        const close = (result) => {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onOk = () => close(withInput ? input.value : true);
        const onCancel = () => close(withInput ? null : false);
        const onKey = (e) => { if (e.key === 'Enter') onOk(); };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
    });
}

function uiConfirm(message) {
    return _openModal(message, false);
}

function uiPrompt(message, defaultValue) {
    return _openModal(message, true, defaultValue);
}
