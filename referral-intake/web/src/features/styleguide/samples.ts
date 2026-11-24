/**
 * SAMPLE values for the styleguide only: synthetic, static, and labelled "Sample"
 * wherever they appear. Screens never use these; every number there comes from the API.
 */
import type { AckCode, ReferralStatus } from "@/contracts";

export type SampleReferral = {
  id: string;
  patient: string;
  dob: string;
  cpt: string;
  study: string;
  payor: string | null;
  confidence: number | null;
  status: ReferralStatus;
  ack: AckCode | null;
  received: string;
};

export const SAMPLE_THRESHOLD = 0.85;

export const SAMPLE_REFERRALS: SampleReferral[] = [
  { id: "s-001", patient: "Novak, Danielle", dob: "1976-05-07", cpt: "74177", study: "CT abdomen and pelvis with contrast", payor: "Northgate Plan", confidence: 0.72, status: "needs_review", ack: null, received: "12m ago" },
  { id: "s-002", patient: "Coleridge, Felix", dob: "2002-03-19", cpt: "71260", study: "CT chest with contrast", payor: "Northgate Plan", confidence: 0.99, status: "ris_error", ack: null, received: "3h ago" },
  { id: "s-003", patient: "Vanderbilt-Ashworthington, Maximiliana Josephine", dob: "1950-02-26", cpt: "72148", study: "MRI lumbar spine without contrast, with additional sagittal STIR sequence requested by referring provider", payor: "Meridian Health Cooperative of the Upper Valley", confidence: 0.41, status: "needs_review", ack: null, received: "14m ago" },
  { id: "s-004", patient: "Halloran, Clara", dob: "1959-12-16", cpt: "74177", study: "CT abdomen and pelvis with contrast", payor: "Northgate Plan", confidence: 0.95, status: "sent_to_ris", ack: "AA", received: "1h ago" },
  { id: "s-005", patient: "Sorensen, Ellis", dob: "1988-10-09", cpt: "73200", study: "CT upper extremity without contrast", payor: "Cascade Mutual", confidence: 0.97, status: "sent_to_ris", ack: "AE", received: "2h ago" },
  { id: "s-006", patient: "Okonkwo, Rowan", dob: "1975-09-16", cpt: "70553", study: "MRI brain with and without contrast", payor: null, confidence: null, status: "processing", ack: null, received: "8s ago" },
  { id: "s-007", patient: "Lindqvist, Renee", dob: "1977-10-04", cpt: "76700", study: "Ultrasound abdomen complete", payor: "Cascade Mutual", confidence: 0.9, status: "rejected", ack: null, received: "1d ago" },
  { id: "s-008", patient: "Duarte, Felix", dob: "2004-11-07", cpt: "77066", study: "Diagnostic mammography bilateral", payor: "Meridian Health", confidence: 0.88, status: "failed", ack: null, received: "5h ago" },
];

export const SAMPLE_HL7_ORM = [
  "MSH|^~\\&|REFERRAL_INTAKE|HOLLIS_PARK|RIS|HOLLIS_PARK|20261123195512||ORM^O01|MSG000123|P|2.5.1",
  "PID|1||MRN0042317^^^HPI^MR||Halloran^Clara||19591216|F",
  "PV1|1|O",
  "ORC|NW|ORDE70F7E38|||||||20261123195512",
  "OBR|1|ORDE70F7E38||74177^CT abdomen and pelvis with contrast^CPT|||20261123195512",
  "DG1|1||R10.9^Unspecified abdominal pain^I10",
].join("\r");

export const SAMPLE_HL7_ACK = [
  "MSH|^~\\&|RIS|HOLLIS_PARK|REFERRAL_INTAKE|HOLLIS_PARK|20261123195513||ACK^O01|ACK000123|P|2.5.1",
  "MSA|AA|MSG000123",
].join("\r");

export const SAMPLE_X12_270 =
  "ISA*00*          *00*          *ZZ*HOLLISPARK     *ZZ*NORTHGATE      *261123*1955*^*00501*000000123*0*T*:~" +
  "GS*HS*HOLLISPARK*NORTHGATE*20261123*1955*123*X*005010X279A1~ST*270*0001*005010X279A1~" +
  "BHT*0022*13*10001234*20261123*1955~HL*1**20*1~NM1*PR*2*NORTHGATE PLAN*****PI*NGP01~" +
  "HL*2*1*21*1~NM1*1P*2*HOLLIS PARK IMAGING*****XX*1234567893~HL*3*2*22*0~" +
  "NM1*IL*1*HALLORAN*CLARA****MI*NGP448812907~DMG*D8*19591216~EQ*30~SE*12*0001~GE*1*123~IEA*1*000000123~";
