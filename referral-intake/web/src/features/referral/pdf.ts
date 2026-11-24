import { pdfjs } from "react-pdf";

// One worker for every react-pdf Document in this feature (fax and packet).
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export { Document, Page } from "react-pdf";
