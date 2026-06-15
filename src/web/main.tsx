/** @jsxImportSource react */
import { createRoot } from "react-dom/client"
import { RouterApp } from "./router"
import "./style.css"

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")
createRoot(root).render(<RouterApp />)
