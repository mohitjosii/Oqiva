"""The permission rules table (ARCHITECTURE section 6.2).

Everything here is a pure function of an AccessContext, so the whole table is
unit-tested without a database. Resolution (who is the caller to this record) lives
in ``resolve.py``; enforcement lives in the services and permission hooks.
"""

from dataclasses import dataclass

ROLE_RANK = {"Guest": 0, "Member": 1, "Admin": 2, "Owner": 3}
SHARE_RANK = {"view": 0, "comment": 1, "edit": 2}


@dataclass(frozen=True)
class AccessContext:
	"""What the caller is to one workspace, project or board."""

	user: str
	role: str | None = None  # workspace role
	share: str | None = None  # best of: DocShare level, live link grant
	is_creator: bool = False  # created the board
	is_owner: bool = False  # owns the workspace
	is_personal: bool = False  # the workspace is somebody's personal workspace
	is_author: bool = False  # wrote the comment
	created_share: bool = False  # created the share row being changed

	@property
	def role_rank(self) -> int:
		return ROLE_RANK.get(self.role, -1)

	@property
	def share_rank(self) -> int:
		return SHARE_RANK.get(self.share, -1)


def _role(ctx: AccessContext, minimum: str) -> bool:
	return ctx.role_rank >= ROLE_RANK[minimum]


def _share(ctx: AccessContext, minimum: str) -> bool:
	return ctx.share_rank >= SHARE_RANK[minimum]


def _can_view(ctx: AccessContext) -> bool:
	# A Guest sees only what is shared with them (fixes Oqiva gap 7).
	return _role(ctx, "Member") or ctx.share_rank >= 0


def _can_comment(ctx: AccessContext) -> bool:
	return _role(ctx, "Member") or _share(ctx, "comment")


def _can_edit(ctx: AccessContext) -> bool:
	return _role(ctx, "Member") or _share(ctx, "edit")


def _can_trash(ctx: AccessContext) -> bool:
	return _role(ctx, "Admin") or (ctx.is_creator and _role(ctx, "Member"))


def _can_modify_share(ctx: AccessContext) -> bool:
	return _role(ctx, "Admin") or ctx.is_creator or ctx.created_share


RULES = {
	# boards
	"board:create": lambda c: _role(c, "Member"),
	"board:view": _can_view,
	"board:export": _can_view,
	"board:favourite": _can_view,
	"board:comment": _can_comment,
	"comment:create": _can_comment,
	"comment:resolve": _can_comment,
	"board:edit": _can_edit,
	"board:rename": _can_edit,
	"version:restore": _can_edit,
	"board:move": lambda c: _role(c, "Member"),
	"board:duplicate": lambda c: _can_view(c) and _role(c, "Member"),
	"board:share": lambda c: _role(c, "Member"),
	"share:modify": _can_modify_share,
	"share:revoke": _can_modify_share,
	"board:archive": _can_trash,
	"board:trash": _can_trash,
	"board:restore": _can_trash,
	"board:purge": _can_trash,
	"version:list": _can_view,
	"version:preview": _can_edit,
	"comment:edit": lambda c: c.is_author,
	"comment:delete": lambda c: c.is_author or _role(c, "Admin"),
	# projects
	"project:view": lambda c: c.role is not None,
	"project:create": lambda c: _role(c, "Member"),
	"project:update": lambda c: _role(c, "Member"),
	"project:archive": lambda c: _role(c, "Admin"),
	"project:trash": lambda c: _role(c, "Admin"),
	"project:restore": lambda c: _role(c, "Admin"),
	# workspaces
	"workspace:view": lambda c: c.role is not None,
	"workspace:leave": lambda c: c.role is not None and not c.is_owner,
	"workspace:update": lambda c: _role(c, "Admin"),
	"workspace:invite": lambda c: _role(c, "Admin"),
	"member:change_role": lambda c: _role(c, "Admin"),
	"member:remove": lambda c: _role(c, "Admin"),
	"workspace:delete": lambda c: c.is_owner and not c.is_personal,
}

ACTIONS = tuple(RULES)


def may(ctx: AccessContext, action: str) -> bool:
	"""Return whether the caller described by ``ctx`` may perform ``action``."""
	rule = RULES.get(action)
	return bool(rule and rule(ctx))


def can_manage_member(actor: AccessContext, target_role: str, new_role: str | None = None) -> bool:
	"""Whether ``actor`` may change or remove a member holding ``target_role``.

	Nobody changes the Owner (ownership transfer is a separate operation). Only the
	Owner changes an Admin, so an Admin cannot demote or remove a peer. Nobody is
	promoted to Owner here.
	"""
	if not (may(actor, "member:change_role") or may(actor, "member:remove")):
		return False
	if target_role == "Owner" or new_role == "Owner":
		return False
	if target_role == "Admin":
		return actor.role == "Owner"
	return True


def capabilities(ctx: AccessContext) -> dict[str, bool]:
	"""The flags the SPA uses to decide which controls to draw."""
	return {
		"can_view": may(ctx, "board:view"),
		"can_comment": may(ctx, "board:comment"),
		"can_edit": may(ctx, "board:edit"),
		"can_rename": may(ctx, "board:rename"),
		"can_move": may(ctx, "board:move"),
		"can_share": may(ctx, "board:share"),
		"can_duplicate": may(ctx, "board:duplicate"),
		"can_trash": may(ctx, "board:trash"),
		"can_export": may(ctx, "board:export"),
	}


def access_level(ctx: AccessContext) -> str | None:
	"""The highest level the caller has on a board: edit, comment, view, or None."""
	for level, action in (("edit", "board:edit"), ("comment", "board:comment"), ("view", "board:view")):
		if may(ctx, action):
			return level
	return None
