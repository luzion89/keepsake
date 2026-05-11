import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/I18nContext.js';

interface ConfirmOptions {
  danger?: boolean;
  okText?: string;
  cancelText?: string;
}

interface DialogState {
  message: string;
  opts: ConfirmOptions;
  resolve: (v: boolean) => void;
}

/** Returns a stable `confirm(message, opts) => Promise<boolean>` function. */
export function useConfirm() {
  const { t } = useT();
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback((message: string, opts: ConfirmOptions = {}): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ message, opts, resolve });
    });
  }, []);

  const handle = (result: boolean) => {
    if (!state) return;
    state.resolve(result);
    setState(null);
  };

  const dialog = state
    ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80"
          onClick={() => handle(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-80 max-w-[90vw] shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-slate-100 leading-relaxed">{state.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => handle(false)}
                className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400"
              >
                {state.opts.cancelText ?? t('confirm.cancel')}
              </button>
              <button
                onClick={() => handle(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  state.opts.danger
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                }`}
              >
                {state.opts.okText ?? t('confirm.ok')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return { confirm, dialog };
}
