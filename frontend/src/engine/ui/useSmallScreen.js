// True on a phone or a narrow tablet, so crowded bars can show icons instead of words.
import { onBeforeUnmount, onMounted, ref } from "vue"

export function useSmallScreen(maxWidth = 639) {
	const small = ref(false)
	let query = null
	const sync = () => (small.value = Boolean(query?.matches))
	onMounted(() => {
		query = window.matchMedia?.(`(max-width: ${maxWidth}px)`) || null
		query?.addEventListener?.("change", sync)
		sync()
	})
	onBeforeUnmount(() => query?.removeEventListener?.("change", sync))
	return small
}
