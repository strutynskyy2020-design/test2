import { useState } from "react";
import { Camera, Image as ImageIcon, Video, FileUp, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";
import api, { extractError, API_BASE } from "@/lib/api";

const fileUrl = (u) => (u?.startsWith("http") ? u : `${API_BASE.replace(/\/api$/, "")}${u}`);

const inputCls = "w-full h-12 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white placeholder:text-zinc-600 focus:border-[#FFB800] outline-none transition-colors";

const UploadButton = ({ testId, icon: Icon, label, accept, capture, multiple, onFiles }) => (
  <label
    data-testid={testId}
    className="flex-1 h-12 rounded-xl bg-[#0A0A0A] border-2 border-white/10 flex items-center justify-center gap-2 text-zinc-300 cursor-pointer active:scale-95 transition-transform"
  >
    <Icon size={16} strokeWidth={2.75} className="text-[#FFB800]" />
    <span className="text-xs font-black uppercase tracking-wider">{label}</span>
    <input
      type="file"
      accept={accept}
      {...(capture ? { capture } : {})}
      multiple={multiple}
      className="hidden"
      onChange={(e) => { onFiles(Array.from(e.target.files || [])); e.target.value = ""; }}
    />
  </label>
);

export default function TaskFormField({ field, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const req = field.required;

  const upload = async (files, multiple) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const urls = [];
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) { toast.error(`${file.name}: більше 25 МБ`); continue; }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", "tasks");
        const { data } = await api.post("/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
        urls.push(data.url);
      }
      if (multiple) onChange([...(Array.isArray(value) ? value : []), ...urls]);
      else onChange(urls[0] || "");
      if (urls.length) toast.success("Завантажено");
    } catch (e) {
      toast.error(extractError(e, "Не вдалось завантажити"));
    } finally {
      setBusy(false);
    }
  };

  const removeAt = (idx) => {
    if (Array.isArray(value)) onChange(value.filter((_, i) => i !== idx));
    else onChange("");
  };

  const label = (
    <label className="block text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">
      {field.label} {req && <span className="text-[#FF3B30]">*</span>}
    </label>
  );

  // ─── Media types (photo / photos / video / file) ───
  if (["photo", "photos", "video", "file"].includes(field.type)) {
    const isMulti = field.type === "photos";
    const isVideo = field.type === "video";
    const isFile = field.type === "file";
    const arr = Array.isArray(value) ? value : value ? [value] : [];
    return (
      <div data-testid={`field-${field.key}`}>
        {label}
        <div className="flex gap-2">
          {isFile ? (
            <UploadButton testId={`upload-file-${field.key}`} icon={FileUp} label="Файл" accept="*/*" onFiles={(f) => upload(f, isMulti)} />
          ) : isVideo ? (
            <>
              <UploadButton testId={`upload-camera-${field.key}`} icon={Video} label="Камера" accept="video/*" capture="environment" onFiles={(f) => upload(f, false)} />
              <UploadButton testId={`upload-gallery-${field.key}`} icon={ImageIcon} label="Галерея" accept="video/*" onFiles={(f) => upload(f, false)} />
            </>
          ) : (
            <>
              <UploadButton testId={`upload-camera-${field.key}`} icon={Camera} label="Камера" accept="image/*" capture="environment" multiple={isMulti} onFiles={(f) => upload(f, isMulti)} />
              <UploadButton testId={`upload-gallery-${field.key}`} icon={ImageIcon} label="Галерея" accept="image/*" multiple={isMulti} onFiles={(f) => upload(f, isMulti)} />
            </>
          )}
        </div>
        {busy && <div className="flex items-center gap-2 text-zinc-400 text-xs mt-2"><Loader2 size={14} className="animate-spin" /> Завантаження...</div>}
        {arr.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {arr.map((u, i) => (
              <div key={i} className="relative aspect-square rounded-xl overflow-hidden border-2 border-white/10 bg-[#0A0A0A]">
                {isVideo ? (
                  <video src={fileUrl(u)} className="w-full h-full object-cover" />
                ) : isFile ? (
                  <div className="w-full h-full flex items-center justify-center"><FileUp size={20} className="text-[#00F0FF]" /></div>
                ) : (
                  <img src={fileUrl(u)} alt="" className="w-full h-full object-cover" />
                )}
                <button type="button" onClick={() => removeAt(i)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/80 border border-white/20 flex items-center justify-center text-white" aria-label="Видалити">
                  <X size={12} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        )}
        {field.help_text && <div className="text-zinc-600 text-[11px] mt-1.5">{field.help_text}</div>}
      </div>
    );
  }

  // ─── Checkbox ───
  if (field.type === "checkbox") {
    return (
      <div data-testid={`field-${field.key}`}>
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 ${value ? "bg-[#39FF14] border-[#39FF14]" : "border-white/20"}`}>
            {value && <Check size={14} strokeWidth={4} color="#0A0A0A" />}
          </div>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="hidden" />
          <span className="text-white text-sm font-bold">{field.label} {req && <span className="text-[#FF3B30]">*</span>}</span>
        </label>
      </div>
    );
  }

  // ─── Select ───
  if (field.type === "select") {
    return (
      <div data-testid={`field-${field.key}`}>
        {label}
        <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          <option value="">— Оберіть —</option>
          {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  // ─── Textarea ───
  if (field.type === "textarea") {
    return (
      <div data-testid={`field-${field.key}`}>
        {label}
        <textarea rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="w-full px-3 py-2.5 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white placeholder:text-zinc-600 focus:border-[#FFB800] outline-none resize-none" />
      </div>
    );
  }

  // ─── Text / number / date / phone / email ───
  const typeMap = { number: "number", date: "date", phone: "tel", email: "email", text: "text" };
  return (
    <div data-testid={`field-${field.key}`}>
      {label}
      <input
        type={typeMap[field.type] || "text"}
        value={value ?? ""}
        onChange={(e) => onChange(field.type === "number" ? e.target.value : e.target.value)}
        placeholder={field.placeholder}
        className={inputCls}
      />
      {field.help_text && <div className="text-zinc-600 text-[11px] mt-1.5">{field.help_text}</div>}
    </div>
  );
}
