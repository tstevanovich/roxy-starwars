// Character package defined by the owner's supplied production workflow.
export const characterPackageLayout = 'production-package';
export const turnaroundViews = ['front', 'three-quarter', 'side', 'rear'];
export const characterPackageBrief =
  'Create a production reference package: a clear neutral three-quarter master portrait; a body turnaround showing front, three-quarter, profile and rear FULL-BODY views with heads visible; neutral/amused/angry/worried/surprised expressions; an exact costume reference; written identity; and separate useful view images. One character and one outfit per turnaround. Use the original approved identity references, keep the same face, hair, proportions, clothing and materials throughout. No readable text, labels, scenery or extra characters.';
const templates = [
  [
    'master-portrait',
    'Master portrait',
    'image',
    'One clear neutral three-quarter portrait, head and shoulders. Preserve the original identity and natural skin texture. Plain light-gray background; even lighting.'
  ],
  [
    'body-turnaround',
    'Body turnaround',
    'image',
    'One production turnaround showing the same character in FOUR COMPLETE FULL-BODY views: front, three-quarter, side profile and rear. Every figure includes its head and feet. Neutral standing poses, hands visible, consistent scale and spacing. Identical face, hair, proportions and exact outfit. Plain light-gray background and even lighting. Each figure is complete from crown to soles; no inset portraits.'
  ],
  [
    'expressions',
    'Expression sheet',
    'image',
    'Five detailed face portraits of the same character: neutral, amused, angry, worried and surprised. Consistent identity, hair, camera scale, skin texture and lighting; natural believable expressions. Plain light-gray background.'
  ],
  [
    'costume-reference',
    'Costume reference',
    'image',
    'Exact costume reference for this ONE outfit, showing clothing front and rear and useful close details of shoes, belt, sleeves and accessories. Preserve the confirmed colors, construction, fit, materials and wear. Do not invent weapons, holsters or accessories. Plain light-gray background.'
  ],
  ['written-identity', 'Written identity', 'notes', ''],
  [
    'view-front',
    'Individual full-body front view',
    'image',
    'One single complete full-body FRONT view of the character, including head and feet. Neutral standing pose, hands visible. Exact identity and approved outfit; plain light-gray background and even lighting. No grid, insets or additional angles.'
  ],
  [
    'view-three-quarter',
    'Individual full-body three-quarter view',
    'image',
    'One single complete full-body THREE-QUARTER view of the character, including head and feet. Neutral standing pose, hands visible. Exact identity and approved outfit; plain light-gray background and even lighting. No grid, insets or additional angles.'
  ],
  [
    'view-profile',
    'Individual full-body profile view',
    'image',
    'One single complete full-body SIDE PROFILE view of the character, including head and feet. Neutral standing pose, hands visible. Exact identity and approved outfit; plain light-gray background and even lighting. No grid, insets or additional angles.'
  ],
  [
    'view-rear',
    'Individual full-body rear view',
    'image',
    'One single complete full-body REAR view of the character, including head and feet. Neutral standing pose, hands visible. Exact identity and approved outfit; plain light-gray background and even lighting. No grid, insets or additional angles.'
  ]
];
export function characterPackageItems() {
  return templates.map(([id, title, type, notes]) => ({
    id,
    title,
    type,
    notes,
    required: true,
    mediaId: null
  }));
}
export function addCharacterPackage(existing = []) {
  const ids = new Set(existing.map((item) => item.id));
  return [...existing, ...characterPackageItems().filter((item) => !ids.has(item.id))];
}
