// Patch notes: what changed between versions of the simulation, in players' words.

export const NOTES_ID = 'v7';

export function notesHtml(): string {
  return `<div class="notes">
  <p class="legend">The second world runs version 7 of the simulation. The first world ran version 6, and you can still visit it at <a href="/commonworld/first">/commonworld/first</a>.</p>

  <h3>A new start</h3>
  <ul>
    <li><b>Founders first.</b> The world began empty. Everyone who founded before midnight arrived in the very first month, and AI peoples only began arriving in year 2, on land no founder had taken, until 20 peoples lived.</li>
    <li><b>Slower time.</b> The world now moves 15 years every real hour, so a day is about 360 years.</li>
  </ul>

  <h3>Names that mean something</h3>
  <ul>
    <li>Every people speaks its own tongue with its own sounds, so their towns, rivers and rulers sound related.</li>
    <li>Towns and rivers are named for what is around them, and you can see what a name means (for example a town whose name means "ford hold" or "high wood").</li>
    <li>Wars and plagues are numbered when they return ("the Second Grey Wasting"), and great works are named after their town.</li>
    <li>A fallen people that rises again takes back its old name. Towns ruled by a foreign tongue for centuries may slowly be renamed.</li>
  </ul>

  <h3>Deeper history</h3>
  <ul>
    <li><b>Tributaries.</b> A beaten people may bow to its conqueror instead of being destroyed. Tributaries pay each year and fight beside their overlord, and may rise up once they are strong again. A released tributary is safe from its old master for 40 years.</li>
    <li><b>Golden and dark ages.</b> Now and then a people flowers (faster growth and learning, more culture, calmer towns) or falls into a dark age (the opposite, and it turns inward instead of making war).</li>
    <li><b>Climate.</b> Warm, cold, wet and dry spells last decades and change harvests across the whole world.</li>
    <li><b>Refugees.</b> People flee famine and war to their own kin's towns.</li>
    <li><b>Royal families.</b> Rulers marry into other houses (which can lead to inheritance wars), child rulers govern through regents, and an ambitious regent may seize the throne.</li>
    <li><b>Peace has terms.</b> The losing side gives up the town under siege. Realms rest a few years between wars.</li>
    <li><b>Ruins.</b> Small towns taken in bitter wars may be burned, and starving hamlets can be abandoned.</li>
    <li><b>Breakaways are real.</b> Peoples that split off take their share of the army with them. A collapsed realm cannot collapse again right away, and a fallen people can rise again only once.</li>
    <li><b>Unrest has causes.</b> Crowded cities and realms with no land left to grow are harder to keep calm. Rich treasuries now hire soldiers in war and buy calm in restless towns.</li>
  </ul>

  <h3>For founders</h3>
  <ul>
    <li>When war comes, there is a third answer: <b>bow to them</b> and become their tributary.</li>
    <li>Not answering a sign never punishes your people: the elders choose for you.</li>
    <li>Your people are protected while they are young (under 120 years) and smaller than most peoples, even if they found a few towns.</li>
    <li>Your council explains what each choice does, and the welcome card explains what founders can do.</li>
  </ul>

  <h3>Easier to read</h3>
  <ul>
    <li>Tap a town's stability, or a neighbour's opinion of you, to see exactly why it is what it is.</li>
    <li>The world page now covers climate, golden and dark ages, overlords and tributaries, and the tongues of the world.</li>
    <li>The map shows tributaries and overlords, the header shows the current climate, and the timeline marks climate swings.</li>
    <li>Peoples that fell within a few years of breaking away are grouped together in the fallen list.</li>
  </ul>
</div>`;
}
