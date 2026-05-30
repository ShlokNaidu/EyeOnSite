import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * ConfirmDialog — replaces native window.confirm() with a styled modal.
 * Props:
 *   isOpen    {boolean}
 *   title     {string}
 *   message   {string}
 *   onConfirm {() => void}
 *   onCancel  {() => void}
 *   dangerous {boolean}  — if true, confirm button is red (default true)
 */
export default function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel, dangerous = true }) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm mx-4 p-6 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${dangerous ? 'bg-red-100' : 'bg-sky-100'}`}>
              <AlertTriangle className={`w-5 h-5 ${dangerous ? 'text-red-500' : 'text-sky-500'}`} />
            </div>
            <h3 className="font-semibold text-slate-800 text-base">{title || 'Are you sure?'}</h3>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 transition-colors ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message */}
        {message && (
          <p className="text-sm text-slate-500 mb-6 ml-13 pl-0">{message}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-all hover:scale-[1.02] ${
              dangerous
                ? 'bg-red-500 hover:bg-red-600 shadow-sm shadow-red-200'
                : 'bg-sky-500 hover:bg-sky-600 shadow-sm shadow-sky-200'
            }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
