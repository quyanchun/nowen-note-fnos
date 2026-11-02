import { useCallback } from "react";
import OriginalAIChatPanel, { type AIChatAsk } from "./AIChatPanel";
import { reliableAsk } from "@/lib/aiReliable";

interface Props {
 onClose:()=>void;onNavigateToNote?:(noteId:string)=>void;
 initialQuestion?:{id:string;question:string};
}

export default function AIChatReliabilityShell(props:Props) {
 const ask=useCallback<AIChatAsk>((question,history,onChunk,onReferences,options,onDiagnostics)=>reliableAsk({
  question,history,mode:"knowledge",notebookId:options?.notebookId,includeChildren:options?.includeChildren,
 },{onChunk,onReferences,onDiagnostics}),[]);
 return <div className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app-bg"><OriginalAIChatPanel {...props} ask={ask} /></div>;
}
