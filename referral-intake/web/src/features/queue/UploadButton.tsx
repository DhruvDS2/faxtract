import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Upload } from "lucide-react";
import { useUpload } from "@/api/queries";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

/**
 * Upload a fax PDF. The run continues in the background, so we go straight to the
 * pipeline graph for the new referral and watch its nodes light up.
 */
export function UploadButton({ variant = "primary", size = "md" }: Pick<ButtonProps, "variant" | "size">) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUpload();
  const navigate = useNavigate();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(
      { file },
      {
        onSuccess: (rec) => {
          toast.success(`Uploaded ${rec.source_name}`, { description: "Pipeline started. Following it on the graph." });
          navigate(`/graph?referral=${rec.id}`);
        },
        onError: (err) => toast.error("Upload failed", { description: err instanceof Error ? err.message : String(err) }),
      },
    );
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        data-testid="upload-input"
        aria-label="Upload fax PDF"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = ""; // allow picking the same file again
        }}
      />
      <Button variant={variant} size={size} onClick={() => input.current?.click()} disabled={upload.isPending}>
        <Upload aria-hidden />
        {upload.isPending ? "Uploading…" : "Upload fax"}
      </Button>
    </>
  );
}
