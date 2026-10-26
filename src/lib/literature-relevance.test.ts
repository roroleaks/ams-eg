import { describe, expect, it } from "vitest";
import { evidenceTier, qualifiesEvidence, dedupeEvidenceRaw, mentions, supportsProduct } from "./literature-relevance";
const paper = { title: "Myo-inositol for PCOS: a randomized controlled trial", abstract: "Methods: Women with PCOS were randomly assigned to myo-inositol supplementation or placebo. Results: Ovulation outcomes were assessed in all participants.", pubType: "Journal Article", year: "2025", doi: "10.1234/test" };
const valid = (p = paper) => qualifiesEvidence(p, ["PCOS", "polycystic ovary syndrome"], ["pcos"], ["myo-inositol"], 2021, 2026);
describe("Tier 1 and Tier 2 clinical evidence only", () => {
  it("accepts a human randomized trial as Tier 2", () => { expect(evidenceTier(paper)).toBe(2); expect(valid()).toBe(true); });
  it("accepts a systematic review as Tier 1", () => { expect(evidenceTier({...paper,title:"Myo-inositol in PCOS: a systematic review"})).toBe(1); });
  it("rejects a non-randomized study", () => { expect(evidenceTier({...paper,abstract:"Methods: A prospective non-randomized study of myo-inositol in women with PCOS. Results: Menstrual outcomes improved."})).toBe(9); });
  it("rejects narrative reviews that merely mention RCTs", () => { expect(evidenceTier({...paper,title:"Inositol in PCOS: a narrative review",abstract:"Methods: We reviewed randomized controlled trials and systematic reviews."})).toBe(9); });
  it("does not promote an observational paper citing a prior meta-analysis", () => { expect(evidenceTier({...paper,title:"Inositol concentrations in PCOS",abstract:"A systematic review supports inositol. Methods: An observational study measured levels in 90 women."})).toBe(9); });
  it("rejects animal experiments even when patients appear in background", () => { expect(evidenceTier({...paper,title:"Inositol and PCOS",abstract:"PCOS affects patients. Methods: Rats were randomized to inositol or placebo. Results: Changes were recorded."})).toBe(9); });
  it("rejects expressions of concern", () => { expect(valid({...paper,title:"Expression of concern: Myo-inositol for PCOS: a randomized controlled trial"})).toBe(false); });
  it("rejects livestock trials", () => { expect(evidenceTier({...paper,title:"Vitamin E administration in pregnant dairy heifers: randomized trial"})).toBe(9); });
  it("rejects poultry meta-analyses", () => { expect(evidenceTier({...paper,title:"Effect of vitamin E supplementation on chicken sperm quality: a meta-analysis"})).toBe(9); });
  it("recognizes compact provider Methods headings", () => { expect(evidenceTier({...paper,title:"Inositol in PCOS",abstract:"BackgroundPCOS is common. MethodsWomen with PCOS were randomized to myo-inositol or placebo. ResultsOvulation improved."})).toBe(2); });
});
describe("Complaint, ingredient and current-year relevance", () => {
  it("rejects an ingredient trial for the wrong complaint", () => { expect(valid({...paper,abstract:paper.abstract.replace("PCOS","diabetes")})).toBe(false); });
  it("rejects a mismatched publisher abstract despite a relevant title", () => { expect(valid({...paper,abstract:"Methods: Patients with cardiovascular disease were randomized to aspirin or placebo. Results: Cardiovascular events were measured after treatment."})).toBe(false); });
  it("rejects an ingredient mentioned only in an unrelated background sentence", () => { expect(valid({...paper,title:"PCOS randomized controlled trial",abstract:"Myo-inositol is used for insomnia. Methods: Women with PCOS were randomized to metformin or placebo. Results: Ovulation improved."})).toBe(false); });
  it("rejects papers older than the requested five-year window", () => { expect(valid({...paper,year:"2014"})).toBe(false); });
  it("rejects future-year papers", () => { expect(valid({...paper,year:"2027"})).toBe(false); });
  it("rejects records without a real article identifier", () => { expect(valid({...paper,doi:""})).toBe(false); });
  it("rejects biomarker-only reviews without therapeutic intent", () => { expect(valid({...paper,title:"Myo-inositol concentrations in PCOS: a systematic review",abstract:"We assessed myo-inositol concentrations in women with PCOS. This systematic review evaluated prevalence and serum levels across observational cohorts."})).toBe(false); });
  it("matches ingredients as words not substrings", () => { expect(mentions("iron supplementation","iron")).toBe(true); expect(mentions("environmental exposures","iron")).toBe(false); });
  it("does not assign a vitamin D paper to a CoQ10-only product", () => { expect(supportsProduct({...paper,title:"Vitamin D in PCOS: systematic review",abstract:"Vitamin D supplementation in PCOS was assessed across randomized trials."},["Coenzyme Q10 (ubiquinone)"])).toBe(false); });
  it("assigns evidence only to products containing the studied ingredient", () => { expect(supportsProduct(paper,["Myo-inositol"])).toBe(true); });
});
describe("Cross-database duplicate evidence", () => {
  it("keeps one canonical paper when a later record adds a DOI", () => { const r=dedupeEvidenceRaw([{title:paper.title,pmid:"123",abstractText:"short",source:"PubMed"},{title:paper.title,doi:paper.doi,abstractText:"longer text",source:"Crossref"}]); expect(r).toHaveLength(1); expect(r[0]?.pmid).toBe("123"); expect(r[0]?.doi).toBe(paper.doi); expect(r[0]?.abstractText).toBe("short"); });
  it("preserves distinct papers sharing the first 120 title characters", () => {const prefix="a".repeat(121); expect(dedupeEvidenceRaw([{title:prefix+"one"},{title:prefix+"two"}])).toHaveLength(2); });
});