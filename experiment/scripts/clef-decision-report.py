"""Build the Oct 8 decision addendum. Requires reportlab; run with python3.
Reads frozen evidence only. Does not change serving configuration or exp-v1.
"""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Flowable

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf/Beli_Group_Taste_Match_Clef_Decision_Addendum.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
diagnostic = json.loads((ROOT / 'experiment/diagnostics/average-fit.json').read_text())
restaurants = {r['id']: r for r in json.loads((ROOT / 'data/v1/restaurants.json').read_text())['restaurants']}
rows = {r['scenarioId']: r for r in diagnostic['results'] if r['repeat'] == 0 and r['status'] == 'scored'}
assert diagnostic['firstRun'] == dict(total=40, scored=32, changed=17, unchanged=15, noMatch=7, failures=1)

GREEN = colors.HexColor('#174C43')
INK = colors.HexColor('#19332F')
MUTED = colors.HexColor('#526860')
PALE = colors.HexColor('#EDF4EF')
GOLD = colors.HexColor('#B27B36')
styles = {
 'title': ParagraphStyle('title',fontName='Helvetica-Bold',fontSize=26,leading=29,textColor=GREEN,spaceAfter=11),
 'subtitle': ParagraphStyle('subtitle',fontName='Helvetica',fontSize=11,leading=15,textColor=MUTED,spaceAfter=10),
 'h2': ParagraphStyle('h2',fontName='Helvetica-Bold',fontSize=14,leading=17,textColor=GREEN,spaceBefore=9,spaceAfter=5),
 'body': ParagraphStyle('body',fontName='Helvetica',fontSize=9.6,leading=13.2,textColor=INK,spaceAfter=7),
 'small': ParagraphStyle('small',fontName='Helvetica',fontSize=8.2,leading=10.5,textColor=MUTED,spaceAfter=5),
 'cell': ParagraphStyle('cell',fontName='Helvetica',fontSize=8.6,leading=11,textColor=INK),
 'head': ParagraphStyle('head',fontName='Helvetica-Bold',fontSize=8.6,leading=11,textColor=colors.white),
 'eyebrow': ParagraphStyle('eyebrow',fontName='Helvetica-Bold',fontSize=8.6,leading=11,textColor=GOLD,spaceAfter=7),
}
story = []
def p(text, style='body'): return Paragraph(text, styles[style])
def add(text, style='body'): story.append(p(text,style))
def title(kicker, heading, sub=None):
 add(kicker.upper(),'eyebrow');add(heading,'title')
 if sub:add(sub,'subtitle')
def table(data,widths, small=False):
 cells = [[p(str(c),'head' if i==0 else ('small' if small else 'cell')) for c in row] for i,row in enumerate(data)]
 t=Table(cells,colWidths=widths,hAlign='LEFT',repeatRows=1)
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),GREEN),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,0),(-1,0),.7,GREEN)]))
 story.append(t);story.append(Spacer(1,10))
def callout(text):
 t=Table([[p(text)]],colWidths=[516]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.6,colors.HexColor('#BCD0C3')),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),5)]));story.append(t);story.append(Spacer(1,10))
def page():story.append(PageBreak())
def name(rid):return escape(restaurants[rid]['name'])
def footer(canvas,doc):
 canvas.setStrokeColor(colors.HexColor('#CCD9D0'));canvas.line(48,42,564,42)
 canvas.setFont('Helvetica',8);canvas.setFillColor(MUTED)
 canvas.drawString(48,28,'GROUP TASTE-MATCH  /  Decision addendum  /  08 October 2026')
 canvas.drawRightString(564,28,f'{doc.page}')

title('Decision record / October 8, 2026','Choose Clef as the<br/>pipeline to develop','From an apparent model-quality gap to a controllable selection-policy problem')
callout('<b>Decision:</b> Julian has selected the Clef pipeline for the next development cycle. Its explicit diner scores and code-owned selection policy provide a more inspectable, replayable way to tune group decisions, alongside a measured speed advantage. This is an engineering and product decision; it does not establish that Clef already outperforms the baseline overall.')
add('What the original experiment established','h2')
add('Experiment v1 compared 240 fixed-state selection runs and 80 complete-flow sessions across 40 held-out synthetic scenarios. A separate model judged fit. Julian, the developer, reviewed the 23 cases where the methods picked different restaurants. [1]')
table([['Measure','Clef','LLM baseline'],['Human preference, differing choices','5 wins','15 wins'],['Acceptable group, fixed-state','21/99 (21%)','26/99 (26%)'],['Acceptable group, complete flow','9/34 (26%)','9/34 (26%)'],['Decision latency, median / p95','5.2 s / 7.9 s','23.0 s / 57.8 s'],['Delivered hard violations','0/160','0/160'],['Valid outcomes','157/160','160/160'],['Mean modal agreement, reordered repeats','66%','87%']],[266,125,125])
add('Human review also recorded one tie and two neither-acceptable outcomes. The fixed-state quality difference (Clef minus baseline) was -5 percentage points, with a 95% interval of -13 to +2: no clear automated quality winner. Neither method met the complete-flow p95 target of 15 seconds. [1]','small')
add('Why the recommendation changed','h2')
add('Our initial interpretation favored the baseline because it more often honored requested cuisines. Inspecting Clef\'s recorded scores showed that it often recognized those preferences too. The minimum-fit selection rule could then discard a strong cuisine match in favor of an evenly weak compromise. Replaying the same scores under highest average fit exposed that policy effect. [2, 3]')
add('This addendum supersedes the earlier recommendation as the <b>development direction</b>. The original experiment remains the historical record. At authoring, the serving configuration still selects the baseline; this document does not deploy a switch or implement average-fit selection. [4]','small')

page()
title('Architecture / what we can control','Separate assessment<br/>from the decision')
add('Both pipelines use gpt-oss-120b to interpret diner requests. Shared deterministic code filters candidates against explicit hard requirements, hours and simulated availability. Both validate the final result and filter private details. The main difference is who applies the group selection policy. [4]')
table([['Stage','Clef pipeline','Baseline pipeline'],['Interpret and filter','Shared LLM interpretation, then code-enforced feasibility','Same shared preparation'],['Assess preferences','Clef returns a 0-4 score and a distribution for each diner-restaurant pair','LLM considers the group directly; individual scores are not recorded'],['Choose restaurant','Code applies an explicit aggregation rule and tie-breaks','gpt-oss-120b is prompted to apply the policy internally'],['Explain result','Separate gpt-oss-120b wording step','The decision call also writes the explanation'],['Inspect a disagreement','Separate score errors from policy effects; replay existing scores','Cannot reconstruct unreported internal scoring from the result']],[110,203,203])
add('Deterministic policy is the established advantage','h2')
add('Given the same scores, candidate facts and tie-break inputs, our selection code returns the same result. The offline diagnostic reproduced all 96 scored Clef selections, then changed only the aggregation rule. This makes policy adjustments measurable without another model call. It does not guarantee that the model inputs or scores remain identical across runs. [2]')
add('What the model documentation supports','h2')
add('Cloudflare describes Clef as evaluating typed options in a single forward pass, with a learned schema head rather than a generated prose answer. Its public inference code applies softmax to option logits; score output is the weighted mean of rubric levels. That path does not sample a text response. [5, 6]')
add('<b>Inference:</b> this removes a source of variability associated with sampled text generation and makes repeatability plausible under fixed inputs and execution. It is not a guarantee of identical hosted outputs. The published endpoint contract provides typed questions and probabilities, but no determinism guarantee. [7]')
callout('<b>Use this claim:</b> Clef gives us more explicit control over the final choice.<br/><b>Do not claim yet:</b> Clef is empirically more repeatable end to end. In exp-v1, the baseline had higher agreement across reordered repeats. That test changed input order; it was not an identical-request repeatability test. [1, 4]')
add('Interpretation, Clef scoring/clarification choices and generated wording remain model-based. Scores are not the pipeline\'s only opaque component. Here, tuning means prompts, rubrics and code policy; no model-weight fine-tuning has been performed.','small')

page()
title('Trace analysis / S09 and S11','The scores recognized cuisine.<br/>The policy chose compromise.')
add('The current rule finds the highest minimum diner score, keeps candidates within 0.15 of that minimum, then selects by highest average. Exact average ties use shorter worst trip, then restaurant ID. The diagnostic instead maximizes average fit across all scored eligible candidates, retaining those last two tie-breaks. [2, 4]')
add('S09: Vietnamese, Ukrainian, and somewhere cozy','h2')
s09=rows['S09']
tab=[['Restaurant','Vietnamese<br/>requester','Ukrainian<br/>requester','Cozy<br/>requester','Minimum','Average']]
for rid in ['thai-diner-nolita','hanoi-house-east-village','veselka-east-village']:
 vals=[s09['scores'][rid][f'd{i}'] for i in range(1,4)]
 tab.append([name(rid),*[f'{v:.2f}' for v in vals],f'{min(vals):.2f}',f'{sum(vals)/3:.2f}'])
table(tab,[126,78,78,78,78,78])
add('Clef gave Hanoi House and Veselka about 2.98 for the diners explicitly requesting their cuisines. The current rule nevertheless selected Thai Diner: its 1.17 minimum beat 0.95 and 0.73, and neither requested option qualified for the shortlist. Highest average fit selected Veselka at 1.95. This was a policy effect with the scores held fixed, not a new inference by Clef. [2]')
add('S11: deli, pizza, vegan, dim sum, and burgers/American','h2')
table([['Selection','Restaurant','Minimum','Average','Worst trip'],['Current rule','Veselka','0.88','1.05','20 min'],['Highest average','Scarr\'s Pizza','0.65','1.61','8 min']],[116,142,78,78,102])
add('The alternative favors a clear pizza match and scores well for the vegan diner, while accepting a worse fit for the dim-sum requester. The tradeoff is explicit: a higher average can improve group cuisine alignment while worsening the lowest individual score. Travel figures are estimated upper bounds. [2, 3]')
add('Correction to the initial interpretation','h2')
add('S03 requested Sichuan, but the frozen fixture marked Birds of a Feather fully booked. S05 requested ramen, but Tonchin was also fully booked. Those restaurants were absent from the eligible scoring lists. These examples do not show Clef ignoring an available exact match. S03\'s Thai Diner choice was from the complete-flow track; the successful fixed-state repeats chose other substitutes. [1, 3]')
callout('The diagnostic identifies the aggregation rule as a material cause of the observed choices. It does not prove that every baseline advantage came from that rule, or that Clef\'s scores are fully accurate. The baseline did not emit a comparable score matrix.')

page()
title('Offline diagnostic / cuisine alignment','Same scores.<br/>Different aggregation.')
add('The comparison used the first scheduled fixed-state run for each of 40 held-out scenarios. It retained failures rather than replacing them with better repeats. Of 32 scored cases, 17 changed and 15 stayed the same; seven cases returned no match and one failed. Across all three repeats, 46 of 96 scored runs changed. No new model calls were made. [2]')
add('Assistant assessment of the 17 changed choices','h2')
add('Reading original requests against the stored cuisine and menu evidence yielded seven clear improvements, one likely improvement, two without a clear gain, and seven with no explicit cuisine/dish request. This is a post-hoc assistant desk review, not new blinded human evidence or a pre-registered metric. [2, 3]')
assessments=[('S09','Clear: Ukrainian request matched'),('S10','Clear: Italian request matched'),('S11','Likely: pizza; diner menu overlap is ambiguous'),('S12','Clear: Southern food and fried chicken'),('S15','No explicit cuisine/dish request'),('S16','No explicit cuisine/dish request'),('S17','No explicit cuisine/dish request'),('S18','No explicit cuisine/dish request'),('S22','Dietary requests; no cuisine/dish request'),('S23','Clear: pizza request matched'),('S28','Clear: noodle request matched'),('S35','No explicit cuisine/dish request'),('S36','No explicit cuisine/dish request'),('S40','Clear for Italian; novelty is separate'),('S41','Clear for pho; other needs are separate'),('S46','No clear gain; neither is Al Di La'),('S47','No clear gain; pasta is not pizza')]
tab=[['Case','Current rule','Highest average','Cuisine assessment']]
for sid,assessment in assessments:
 row=rows[sid];tab.append([sid,name(row['current']['restaurantId']),name(row['average']['restaurantId']),assessment])
table(tab,[42,132,132,210],small=True)
add('Average fit is not majority voting. It still includes history, price, atmosphere and travel. These reviewed test scenarios are now diagnostic material; they cannot serve as fresh held-out confirmation for the next tuned policy. No revised acceptable-group rate or new human win rate is claimed.','small')

page()
title('Product judgment / why develop Clef','Make the tradeoffs<br/>visible and adjustable')
add('The Sana / IngredientGPT lesson','h2')
add('Julian describes a similar difficulty while building Sana, also known as IngredientGPT: skincare product analysis relied on one large LLM API call, and prompt adjustments did not reliably produce the desired outcomes. The model made several judgments inside a single opaque step, making it difficult to identify which change would fix an unwanted result. This is Julian\'s own account, not an independently measured study.')
add('The Clef architecture offers a practical response to that experience. We can inspect the assessment separately from the decision rule. If scores recognize a cuisine but the selected restaurant does not reflect it, change the policy and replay the same evidence. If the scores fail to recognize the request, investigate interpretation, data or the scoring rubric. The current diagnostic demonstrates the first workflow.')
callout('<b>Decision rationale:</b> choose Clef as the foundation for continued development because its decision policy is explicit, testable and replaceable, and its measured selection latency is lower. Improved end-to-end determinism is a goal of this work, not an established experiment result.')
add('Highest minimum vs. majority choice and minority investment','h2')
add('Julian\'s hypothesis: when cuisines conflict, favor the cuisine with more support, then reduce price and travel for diners whose cuisine loses. Test this as an explicit selection policy using stated cuisine support, unmet requests and each diner\'s cost and trip. Add a floor against severe individual mismatch. Firm budget and travel limits remain feasibility rules; tonight\'s request outranks the taste profile. Compare this policy with minimum and pure-average fit on development cases. This is a proposed fair-compromise rule, not an exp-v1 finding.')
add('What to tune next','h2')
table([['Workstream','Concrete next step'],['Selection policy','Evaluate highest average fit alongside safeguards against an unacceptable minority outcome. The diagnostic supports testing average fit; it does not settle the final policy.'],['Product priorities','Preserve hard affordability and travel limits. Make current requests outrank profiles. Decide how cuisine support, soft budgets and travel tradeoffs enter the rule.'],['Compromise hypothesis','Test whether diners whose cuisine loses prefer lower cost and shorter travel. Treat this as a hypothesis, with explicit diner preferences taking precedence.'],['Score repeatability','Repeat identical serialized requests with caching off; separately vary diner/candidate order and question batches. Compare score drift and final selections.'],['Fresh validation','Tune on development cases, version the policy and rubric, freeze exp-v2, then evaluate on a fresh held-out set with independent review.']],[122,394])
add('The earlier prompt-order and profile-fallback decisions remain open. Budget sensitivity must not become an invented spending cap, and a majority preference must never override a diner\'s hard requirement. Retain the baseline as a benchmark while developing Clef.','small')

page()
title('vNext notes / deferred design work','How we might tune<br/>the Clef pipeline','Working hypotheses and open choices - no policy or model changes in this report')
add('Product principles already stated','h2')
table([['Principle','Intended behavior'],['Affordability','Keep every stated hard budget cap in the feasibility filter. Give a soft price concern meaningful weight; do not infer a dollar maximum from words such as "broke."'],['Cuisine support','When diners want different cuisines, favor the cuisine with more support among feasible choices. Count diners, not repeated words in a request.'],['Hard vs. soft travel','"Cannot travel more than 20 minutes" excludes unverifiable or longer trips; "prefer close" influences ranking.'],['Current request','Tonight\'s words and clarification outrank synthetic profile history. Profile use when a dimension is silent still needs a decision.'],['Compensation hypothesis','If a diner does not get their preferred cuisine, test whether lower all-in cost and a shorter trip make the compromise more acceptable.']],[116,400])
add('A candidate policy to evaluate, not a frozen rule','h2')
add('First, filter on every diner\'s hard requirements. Then compute cuisine or dish support from current requests for each eligible restaurant, using verified menu evidence. Track whose request is unmet. Compare soft cost and travel burden for those diners, while keeping a minimum individual-fit safeguard. Use average fit and stable tie-breaks after these priorities. The exact order, thresholds, treatment of multiple acceptable cuisines and whether to ask the host about a material tie are open choices.')
add('Separate score quality from policy quality','h2')
add('Replay recorded Clef scores under alternative selection rules to isolate policy effects. For scoring changes, inspect whether Clef recognizes requested cuisine, dishes, price leanings and travel preferences before changing the aggregation. Consider separate score components or clearer rubric anchors if one 0-4 score hides an important tradeoff. Repeated identical requests can test score repeatability; reordered diners, restaurants and question batches test sensitivity to presentation.')
add('Evidence needed before promotion','h2')
add('Use the 20 development scenarios for initial tuning and collect direct judgments about both the majority\'s match and the minority\'s cost and travel burden. Once prompts, data, rubric and selection policy are fixed, version exp-v2 and use a fresh held-out set for confirmation. Keep the baseline for comparison. Previously reviewed exp-v1 scenarios are diagnostic examples, not fresh test evidence. The preference-order and profile-fallback questions remain open with Julian.')
callout('<b>Status:</b> These are design notes. No Clef prompt, selection code, serving default, provider setting or experiment protocol was changed by recording them.')

page()
title('Evidence / reproducibility','What supports this decision')
add('Local project evidence','h2')
refs=[
 ('[1] Original experiment and review','Beli_Group_Explore_Experiment_Report.md; experiment/results/metrics.csv; experiment/review/human_results.json. Historical exp-v1 recommendation favored the baseline.'),
 ('[2] Offline policy replay','experiment/diagnostics/average-fit.json and average-fit.html; experiment/scripts/compare-selection.ts. Diagnostic commit: f9dc657. All 96 scored current-policy decisions reproduced.'),
 ('[3] Original inputs and traces','experiment/results/runs.jsonl; experiment/frozen/fixed_state_inputs.test.json; experiment/dataset_manifest.json; experiment/scenarios/v1.json; data/v1/restaurants.json.'),
 ('[4] Implementation and metric definitions','src/server/clef.ts; src/server/policy.ts; src/server/methods/baseline-method.ts; src/server/interpret.ts; experiment/scripts/analyze.ts; wrangler.jsonc.'),
]
for heading,body in refs:add(heading,'h2');add(escape(body),'small')
add('Primary technical sources checked October 8, 2026','h2')
links=[('[5] Cloudflare Clef model card','https://huggingface.co/Cloudflare/clef','Typed options, single forward pass and the learned schema head.'),('[6] Cloudflare public inference implementation','https://huggingface.co/Cloudflare/clef/blob/main/joint_schema_model.py','systemone() and systemone_answer(): probabilities and weighted score computation; public code is not proof of the hosted service implementation.'),('[7] Workers AI Clef API reference','https://developers.cloudflare.com/workers-ai/models/clef/','Hosted typed-question interface and returned probabilities; no stated identical-output guarantee.')]
for label,url,note in links:
 add(f'<link href="{url}" color="#174C43"><u>{label}</u></link>','body');add(escape(url),'small');add(note,'small')
add('Reproduce and interpret','h2')
add('Replay: <font name="Courier" size="8.5">pnpm exec tsx experiment/scripts/compare-selection.ts</font><br/>Build this PDF: <font name="Courier" size="8.5">python3 experiment/scripts/clef-decision-report.py</font> (ReportLab required).','small')
add('The diagnostic JSON retains input hashes and individual score matrices. No additional provider calls, model training, deployment or policy change was performed to produce this report. The new cuisine assessment is qualitative and based on a limited restaurant snapshot. The original 66% and 87% stability figures are averages of each scenario\'s modal-choice share across reordered repeats, not the percentage of scenarios with all three choices identical.','small')
add('Independent concept prototype. Synthetic diners and histories, simulated availability, approximate travel and model-judged fit do not measure real dining satisfaction. The new decision reflects a preference for controllability and a promising diagnostic, while preserving the original baseline-favoring human evidence.','small')

doc=SimpleDocTemplate(str(OUT),pagesize=(612,792),rightMargin=48,leftMargin=48,topMargin=42,bottomMargin=53,title='Group Taste-Match: Choosing Clef for Continued Development',author='Julian Laxman / Group Taste-Match',subject='Architecture decision and offline selection-policy diagnostic, October 8, 2026')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)
