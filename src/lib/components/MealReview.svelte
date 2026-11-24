<script lang="ts">
  import { nutrientFormatter } from '../client/nutrition';
  import type { Pending } from '../client/types';
  import { mealTitle, sameMealItem, type MealTitleItem } from '../meal-title';
  import { mealLabels } from '../meal-types';
  import type {
    ClarificationAnswer,
    ClarificationIssue,
    ReviewReplacement
  } from '../server/agent/clarify';
  import type { CatalogSelection } from '../server/agent/proposal';
  import type { Choice } from './FoodPicker.svelte';
  import Metrics from './Metrics.svelte';
  import ReplaceItem from './ReplaceItem.svelte';

  let {
    pending,
    disabled,
    onconfirm
  }: {
    pending: Pending;
    disabled: boolean;
    onconfirm: (answers: ClarificationAnswer[], replacements: ReviewReplacement[]) => void;
  } = $props();
  let replacementEditor: ReturnType<typeof ReplaceItem>;
  const number = nutrientFormatter();
  let editingIndex: number;
  let replacements = $state<Record<number, { replacement: CatalogSelection; choice: Choice }>>({});
  let grams = $state<Record<number, number | undefined>>({});
  let choices = $state<Record<number, string | undefined>>({});
  let issues = $derived(
    pending.clarification
      ? [pending.clarification, ...(pending.clarification.additional ?? [])]
      : []
  );
  let reviewOrder = $derived(
    pending.proposal.meals?.flatMap(({ itemIndexes, title, meal }, group) =>
      itemIndexes.map((index, position) => ({
        index,
        heading:
          position === 0 ? (title ?? (meal ? mealLabels[meal] : `Meal ${group + 1}`)) : undefined
      }))
    ) ?? pending.proposal.items.map((_, index) => ({ index, heading: undefined }))
  );
  let review = $derived(
    reviewOrder.map(({ index, heading }) => ({
      index,
      heading,
      item:
        pending.items?.find((item) => item.itemIndex === index) ??
        (!pending.clarification ? pending.items?.[index] : undefined),
      issue: issues.find(({ itemIndex }) => itemIndex === index)
    }))
  );
  let title = $derived(
    (!Object.entries(replacements).some(
      ([index, { replacement }]) =>
        !sameMealItem(pending.proposal.items[Number(index)]!, replacement)
    )
      ? pending.proposal.title
      : undefined) ??
      mealTitle(
        review.flatMap<MealTitleItem>(({ index, item }) => {
          const staged = replacements[index];
          if (!staged) return item ? [item] : [];
          return [
            {
              label: staged.choice.name,
              nameEn: staged.choice.nameEn,
              grams: staged.replacement.kind === 'food' ? staged.replacement.quantity : item?.grams
            }
          ];
        }),
        pending.proposal.meal && pending.proposal.meal !== 'other'
          ? mealLabels[pending.proposal.meal]
          : 'Meal review'
      )
  );

  function canEdit(issue: ClarificationIssue) {
    return (
      issue.canEditGrams ??
      (issue.code === 'UNIT_UNRESOLVED' && pending.proposal.items[issue.itemIndex]?.kind === 'food')
    );
  }

  function answer(issue: ClarificationIssue): ClarificationAnswer | null {
    const { itemIndex } = issue;
    const weight = grams[itemIndex];
    if (weight && canEdit(issue)) return { itemIndex, grams: weight };
    const accepted = issue.options.find(({ selection }) => selection.kind === 'accept')?.id;
    const optionId = choices[itemIndex] ?? accepted;
    return optionId ? { itemIndex, optionId } : null;
  }

  let answers = $derived(issues.filter(({ itemIndex }) => !replacements[itemIndex]).map(answer));
  let oneTap = $derived(
    !pending.proposal.meals &&
      review.length === 1 &&
      issues[0]?.code === 'AMBIGUOUS_MATCH' &&
      issues[0].options.length > 0 &&
      !replacements[0]
  );
  function select(issue: ClarificationIssue, optionId: string) {
    if (oneTap) {
      onconfirm([{ itemIndex: issue.itemIndex, optionId }], []);
    } else {
      choices[issue.itemIndex] = optionId;
    }
  }

  function replace(index: number, label: string, weight?: number) {
    editingIndex = index;
    replacementEditor.open(label, weight);
  }

  function confirm() {
    onconfirm(
      answers.filter((item) => item !== null),
      Object.entries(replacements).map(([index, { replacement }]) => ({
        itemIndex: Number(index),
        replacement
      }))
    );
  }
</script>

<section
  aria-label={pending.clarification ? 'Clarification choices' : 'Meal preview'}
  class="panel stack"
>
  <h3>{pending.proposal.meals ? 'Review meals' : title}</h3>
  {#each review as { index, item, issue, heading } (index)}
    {@const staged = replacements[index]}
    {@const label = staged?.choice.name ?? item?.label}
    {@const weight = staged
      ? staged.replacement.kind === 'food'
        ? staged.replacement.quantity
        : undefined
      : item?.grams}
    <div class="review-item stack">
      {#if heading}<h4>{heading}</h4>{/if}
      {#if label}
        <div class="row">
          <button
            class="item-link"
            type="button"
            {disabled}
            aria-label={`Replace ${label}`}
            onclick={() => replace(index, label, weight)}>{label}</button
          >
          {#if staged}
            <span class="small muted"
              >{staged.replacement.kind === 'food'
                ? `${staged.replacement.quantity} g`
                : `${staged.replacement.servings} ${staged.replacement.servings === 1 ? 'serving' : 'servings'}`}</span
            >
            <button
              class="button quiet"
              type="button"
              {disabled}
              onclick={() => delete replacements[index]}>Reset replacement</button
            >
          {:else if item}
            <span class="small muted">{number.format(item.grams)} g</span>
            {#if issue?.code === 'LOW_CONFIDENCE' || issue?.code === 'ESTIMATE_CONFIRMATION'}
              <span class="small muted">Needs confirmation</span>
            {/if}
          {/if}
        </div>
      {/if}
      {#if item && !staged}
        {#if item.assumptions.length}
          <p class="small muted">{item.assumptions.join(' ')}</p>
        {/if}
        <Metrics amounts={item.nutrients} compact basis="Proposed amount" />
      {/if}
      {#if issue && !staged}
        {#if issue.code === 'AMBIGUOUS_MATCH' || issue.code === 'UNIT_UNRESOLVED' || !item}
          <p>{issue.question}</p>
        {/if}
        {#each issue.options.filter(({ selection }) => selection.kind !== 'accept') as option (option.id)}
          <button
            class="button choice"
            type="button"
            {disabled}
            aria-pressed={choices[index] === option.id}
            onclick={() => select(issue, option.id)}
          >
            <strong>{option.label}</strong>
            {#if option.nutrients}<Metrics amounts={option.nutrients} compact />{/if}
          </button>
        {/each}
        {#if canEdit(issue)}
          <label
            >Grams for {item?.label ?? issue.phrase ?? 'this item'}
            <input
              type="number"
              min="0.01"
              step="any"
              placeholder={item ? String(Number(item.grams.toPrecision(3))) : undefined}
              bind:value={grams[index]}
              {disabled}
            />
          </label>
        {/if}
        {#if !item}
          <button
            class="button"
            type="button"
            {disabled}
            onclick={() => replace(index, issue.phrase ?? 'this item')}>Choose replacement</button
          >
        {/if}
      {/if}
    </div>
  {/each}
  {#if !oneTap}
    <button
      class="button primary"
      type="button"
      disabled={disabled || answers.some((item) => !item)}
      onclick={confirm}
      >{pending.clarification
        ? pending.proposal.meals
          ? 'Confirm meals'
          : 'Confirm meal'
        : 'Confirm and log'}</button
    >
  {/if}
</section>

<ReplaceItem
  bind:this={replacementEditor}
  onreplace={(replacement, choice) => {
    replacements[editingIndex] = { replacement, choice };
  }}
/>

<style>
  .review-item {
    border-top: 1px solid var(--line);
    padding-top: 10px;
    gap: 7px;
  }
  h4 {
    margin: 0;
    color: var(--accent);
    font-size: 0.9rem;
  }
  .choice {
    text-align: left;
    justify-content: flex-start;
    align-items: flex-start;
    flex-direction: column;
    padding: 10px 13px;
  }
  .choice[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  input {
    width: 140px;
  }
</style>
