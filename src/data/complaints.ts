// PRIMARY complaint → product database (source: AMS APP.xlsx).
// Spelling normalized; `aliases` add clinical synonyms used for semantic matching.

export interface ComplaintEntry {
  /** Canonical indication text shown to clinicians. */
  label: string;
  /** Extra phrasing used only for matching (never displayed). */
  aliases?: string[];
}

export interface ProductRecord {
  /** Must match the product name used in chunks.json / product-images.ts */
  name: string;
  complaints: ComplaintEntry[];
}

export const PRODUCT_DB: ProductRecord[] = [
  {
    name: "Ova-Max",
    complaints: [
      {
        label: "Poor ovarian reserve",
        aliases: ["diminished ovarian reserve", "low AMH", "low anti-Mullerian hormone", "poor responder", "low antral follicle count", "ovarian aging"],
      },
      { label: "Secondary infertility at a young age", aliases: ["young secondary infertility"] },
      { label: "Idiopathic infertility", aliases: ["unexplained infertility"] },
      { label: "Egg freezing", aliases: ["oocyte cryopreservation", "fertility preservation"] },
      { label: "Poor oocyte quality", aliases: ["poor quality of ova", "poor egg quality", "low oocyte competence"] },
      { label: "Low AMH", aliases: ["low anti-Mullerian hormone", "AMH decline"] },
      { label: "Luteal phase defect", aliases: ["short luteal phase", "low progesterone"] },
      { label: "Hormonal imbalance", aliases: ["endocrine imbalance"] },
      { label: "Hyperprolactinemia", aliases: ["high prolactin"] },
    ],
  },
  {
    name: "WFS Plus",
    complaints: [
      { label: "PCOS", aliases: ["polycystic ovary syndrome", "polycystic ovaries"] },
      { label: "Insulin resistance", aliases: ["impaired glucose tolerance", "hyperinsulinemia"] },
      { label: "Irregular menstrual cycle", aliases: ["oligomenorrhea", "irregular periods", "anovulatory cycles"] },
      { label: "Hyperandrogenism", aliases: ["high androgens", "high testosterone in women"] },
      { label: "Dyslipidemia", aliases: ["abnormal lipid profile", "high cholesterol"] },
    ],
  },
  {
    name: "Preconception Plus",
    complaints: [
      { label: "Advanced maternal age", aliases: ["older mother", "age over 35 pregnancy"] },
      { label: "Recurrent miscarriage", aliases: ["recurrent pregnancy loss", "repeated abortion"] },
      { label: "Bad obstetric history", aliases: ["previous poor pregnancy outcome"] },
      { label: "During pregnancy", aliases: ["antenatal supplementation", "pregnancy support"] },
      { label: "Preterm labor", aliases: ["premature birth", "preterm delivery risk"] },
    ],
  },
  {
    name: "FibroMed",
    complaints: [
      { label: "Small uterine fibroid", aliases: ["small myoma", "small leiomyoma"] },
      { label: "Medium uterine fibroid", aliases: ["medium myoma", "uterine leiomyoma"] },
      { label: "Premenstrual syndrome (PMS)", aliases: ["premenstrual tension"] },
      { label: "Pelvic pain", aliases: ["chronic pelvic pain"] },
      { label: "Heavy menstrual bleeding", aliases: ["menorrhagia", "heavy periods", "abnormal uterine bleeding"] },
      { label: "Pelvic pressure", aliases: ["bulk symptoms", "pelvic heaviness"] },
      { label: "Low pregnancy rate due to uterine fibroid", aliases: ["fibroid related infertility"] },
      { label: "Pre- and post-operative fibroid support", aliases: ["before myomectomy", "after myomectomy"] },
      { label: "Estrogen dominance", aliases: ["high estrogen", "unopposed estrogen"] },
      { label: "Dysmenorrhea", aliases: ["painful periods", "menstrual cramps"] },
    ],
  },
  {
    name: "MetrioMed",
    complaints: [
      { label: "Diagnosed endometriosis", aliases: ["confirmed endometriosis"] },
      { label: "Suspected endometriosis", aliases: ["possible endometriosis"] },
      { label: "Recurrent endometriosis", aliases: ["endometriosis relapse", "after endometriosis surgery"] },
      { label: "Premenopausal symptoms", aliases: ["perimenopause", "menopausal symptoms"] },
      { label: "Premenstrual syndrome (PMS)" },
      { label: "Pelvic pressure" },
      { label: "Estrogen dominance", aliases: ["high estrogen"] },
      { label: "Dysmenorrhea", aliases: ["painful periods", "painful menstruation"] },
      { label: "Ovulatory dysfunction", aliases: ["anovulation", "irregular ovulation"] },
      { label: "Impaired fertilization", aliases: ["poor fertilization rate"] },
      { label: "Heavy menstrual bleeding", aliases: ["menorrhagia"] },
      { label: "Recurrent hemorrhagic ovarian cyst", aliases: ["endometrioma", "chocolate cyst"] },
    ],
  },
  {
    name: "Polysitol",
    complaints: [
      { label: "PCOS", aliases: ["polycystic ovary syndrome"] },
      { label: "Insulin resistance", aliases: ["hyperinsulinemia"] },
      { label: "Infertility", aliases: ["difficulty conceiving"] },
      { label: "Hirsutism", aliases: ["excess facial hair", "unwanted hair growth"] },
      { label: "Acne", aliases: ["hormonal acne"] },
      { label: "Alopecia", aliases: ["hair loss", "androgenic alopecia"] },
      { label: "Irregular menstrual cycle", aliases: ["oligomenorrhea", "irregular periods"] },
      { label: "Metabolic syndrome" },
      { label: "Disturbed lipid metabolism", aliases: ["dyslipidemia"] },
      { label: "Hypertension", aliases: ["high blood pressure"] },
      { label: "Hyperandrogenism", aliases: ["high androgens"] },
    ],
  },
  {
    name: "Breast-Well",
    complaints: [
      { label: "Benign breast tumor", aliases: ["fibroadenoma", "benign breast lump"] },
      { label: "Fibrocystic breast changes", aliases: ["breast cysts", "lumpy breasts"] },
      { label: "Cyclic mastalgia", aliases: ["cyclical breast pain"] },
      { label: "High breast density", aliases: ["dense breast tissue"] },
      { label: "Breast pain", aliases: ["mastalgia", "breast tenderness"] },
    ],
  },
  {
    name: "MFS Plus",
    complaints: [
      { label: "Triple defect semen abnormality", aliases: ["oligoasthenoteratozoospermia", "OAT syndrome"] },
      { label: "High DNA fragmentation index (DFI)", aliases: ["sperm DNA damage", "high DFI"] },
      { label: "Low free testosterone", aliases: ["hypogonadism", "low testosterone"] },
      { label: "High cortisol level", aliases: ["stress related infertility"] },
      { label: "High reactive oxygen species (ROS)", aliases: ["seminal oxidative stress"] },
      { label: "Low antioxidant concentration", aliases: ["low seminal antioxidant capacity"] },
      { label: "Low sperm vitality", aliases: ["necrozoospermia", "poor sperm viability"] },
      { label: "Low sperm count", aliases: ["oligozoospermia", "low sperm concentration"] },
      { label: "Low semen volume", aliases: ["hypospermia"] },
      { label: "Male infertility", aliases: ["male factor infertility"] },
    ],
  },
  {
    name: "Motility Max",
    complaints: [
      { label: "Severe asthenospermia", aliases: ["severe low sperm motility"] },
      { label: "Isolated asthenospermia", aliases: ["poor sperm motility", "low sperm movement"] },
      { label: "High semen viscosity", aliases: ["thick semen"] },
      { label: "Progressive motility below 20%", aliases: ["poor progressive motility"] },
      { label: "First and second stage varicocele", aliases: ["grade I varicocele", "grade II varicocele"] },
      { label: "After varicocelectomy", aliases: ["post varicocele surgery"] },
      { label: "Low antioxidant concentration", aliases: ["oxidative stress in semen"] },
      { label: "Male infertility", aliases: ["male factor infertility"] },
    ],
  },
  {
    name: "PenaMax",
    complaints: [
      { label: "Erectile dysfunction", aliases: ["impotence", "poor erection"] },
      { label: "Desire dysfunction", aliases: ["hypoactive sexual desire"] },
      { label: "Depression related to sexual dysfunction", aliases: ["mood related sexual problems"] },
      { label: "Low sexual stamina", aliases: ["poor sexual performance"] },
      { label: "Low libido", aliases: ["reduced sex drive"] },
    ],
  },
  {
    name: "Q-Well 200mg",
    complaints: [
      { label: "Infertility", aliases: ["difficulty conceiving"] },
      { label: "Poor ovarian reserve", aliases: ["low AMH", "diminished ovarian reserve", "poor responder"] },
      { label: "Anovulation", aliases: ["absent ovulation", "ovulatory dysfunction"] },
      { label: "PCOS", aliases: ["polycystic ovary syndrome"] },
    ],
  },
  {
    name: "Uticyst",
    complaints: [
      { label: "Urinary tract infection", aliases: ["UTI", "cystitis", "bladder infection"] },
      { label: "Recurrent UTI", aliases: ["recurrent cystitis", "repeated urinary infection"] },
      { label: "Vaginal dryness", aliases: ["vaginal atrophy", "genitourinary syndrome"] },
    ],
  },
];

/** Flat list of every (product, complaint) pair — the embedding index order. */
export interface ComplaintIndexItem {
  product: string;
  label: string;
  matchText: string;
}

export const COMPLAINT_INDEX: ComplaintIndexItem[] = PRODUCT_DB.flatMap((p) =>
  p.complaints.map((c) => ({
    product: p.name,
    label: c.label,
    matchText: [c.label, ...(c.aliases ?? [])].join(", "),
  })),
);

export function complaintsFor(product: string): string[] {
  return PRODUCT_DB.find((p) => p.name === product)?.complaints.map((c) => c.label) ?? [];
}

/** Every distinct complaint label, for the quick-pick chips. */
export const ALL_COMPLAINTS: string[] = [
  ...new Set(PRODUCT_DB.flatMap((p) => p.complaints.map((c) => c.label))),
].sort();
