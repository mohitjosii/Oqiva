// The words for the three ways a board can be shared.

export const SHARE_LEVELS = [
	{ value: "view", label: "Can view", description: "Look at the board" },
	{ value: "comment", label: "Can comment", description: "View, and leave comments" },
	{ value: "edit", label: "Can edit", description: "View, comment and change the board" },
]

export const levelLabel = (level) => SHARE_LEVELS.find((l) => l.value === level)?.label || level
