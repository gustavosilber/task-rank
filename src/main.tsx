import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { WorkspaceProvider } from "./WorkspaceContext"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </StrictMode>,
)
