/**
 * Product analytics event catalog. One place for names so client, server, and dashboards agree.
 * Student success is read as a funnel: signed_in → chat_started → policy_revision_saved →
 * policy_uploaded → hosted_game_requested → hosted_game_completed → league_entered.
 */
export const events = {
  // Session
  signedIn: "signed_in",
  signedOut: "signed_out",
  // Chat with the Neural Viking Agent
  chatStarted: "chat_started",
  chatMessageSent: "chat_message_sent",
  chatPasteAttempted: "chat_paste_attempted",
  attachmentUploaded: "attachment_uploaded",
  attachmentRejected: "attachment_rejected",
  updatesOpened: "policy_updates_opened",
  draftDiscarded: "policy_draft_discarded",
  suggestionClicked: "suggestion_clicked",
  referenceOpened: "reference_opened",
  agentToolCompleted: "agent_tool_completed",
  agentTurnCompleted: "agent_turn_completed",
  agentApprovalRequested: "agent_approval_requested",
  agentApprovalAnswered: "agent_approval_answered",
  agentError: "agent_error",
  chatAttachmentAdded: "chat_attachment_added",
  chatDictationStarted: "chat_dictation_started",
  chatMessageSpoken: "chat_message_spoken",
  chatMessageCopied: "chat_message_copied",
  chatStreamResumed: "chat_stream_resumed",
  chatSteered: "chat_steered",
  chatThreadsOpened: "chat_threads_opened",
  chatRenamed: "chat_renamed",
  reasoningEffortChanged: "reasoning_effort_changed",
  // Policy lifecycle (server-side, from the agent's tools)
  policyRevisionSaved: "policy_revision_saved",
  policyUploaded: "policy_uploaded",
  hostedGameRequested: "hosted_game_requested",
  hostedGameChecked: "hosted_game_checked",
  hostedGameCompleted: "hosted_game_completed",
  leagueStandingRead: "league_standing_read",
  leagueEntered: "league_entered",
  coachingFeedbackRead: "coaching_feedback_read",
  labSynced: "lab_synced",
  // Workspace UI
  tabViewed: "tab_viewed",
  revisionViewed: "revision_viewed",
  policyDownloaded: "policy_downloaded",
  replayOpened: "replay_opened",
  replayReady: "replay_ready",
  replayFailed: "replay_failed",
  replayFullscreen: "replay_fullscreen_toggled",
  replayNoteDiscussed: "replay_note_discussed",
  coachingRecordingStarted: "coaching_recording_started",
  coachingRecordingFinished: "coaching_recording_finished",
  coachingRecordingFailed: "coaching_recording_failed",
  coachingSaved: "coaching_session_saved",
  coachingAnalysisRequested: "coaching_analysis_requested",
  coachingApplied: "coaching_applied_to_policy",
  splitResized: "split_resized",
} as const;

export type EventName = (typeof events)[keyof typeof events];
