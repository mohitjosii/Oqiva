<script setup>
// A grid to choose a table's size by hovering and clicking: the squares up to the pointer
// light up, and the label says how many rows and columns that is.
import { computed, ref } from "vue"
import { TABLE_LIMITS } from "../model/schema"

const emit = defineEmits(["pick"])
const SHOWN = { rows: 8, cols: 8 }
const hover = ref({ rows: 3, cols: 3 })
const label = computed(() => `${hover.value.rows} × ${hover.value.cols} table`)
const lit = (row, col) => row <= hover.value.rows && col <= hover.value.cols
const pick = (rows, cols) =>
	emit("pick", {
		rows: Math.min(rows, TABLE_LIMITS.maxRows),
		cols: Math.min(cols, TABLE_LIMITS.maxCols),
	})
</script>

<template>
	<div class="flex flex-col gap-2" data-testid="table-size-picker">
		<div
			class="grid gap-1"
			:style="{ gridTemplateColumns: `repeat(${SHOWN.cols}, 1.25rem)` }"
			role="grid"
			aria-label="Table size"
		>
			<template v-for="row in SHOWN.rows" :key="row">
				<button
					v-for="col in SHOWN.cols"
					:key="`${row}-${col}`"
					type="button"
					class="h-5 w-5 rounded-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
					:class="
						lit(row, col)
							? 'border-outline-gray-5 bg-surface-gray-4'
							: 'border-outline-gray-2 bg-surface-white'
					"
					:title="`${row} × ${col}`"
					:aria-label="`${row} rows by ${col} columns`"
					:data-testid="`table-size-${row}x${col}`"
					@pointerenter="hover = { rows: row, cols: col }"
					@focus="hover = { rows: row, cols: col }"
					@click="pick(row, col)"
				/>
			</template>
		</div>
		<p class="text-center text-xs text-ink-gray-6" aria-live="polite">{{ label }}</p>
	</div>
</template>
