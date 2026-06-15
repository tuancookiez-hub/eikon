import { Route as root } from "./routes/__root"
import { Route as index } from "./routes/index"
import { Route as detail } from "./routes/gallery.$sourceKey"
import { Route as account } from "./routes/account"
import { Route as upload } from "./routes/upload"
import { Route as callback } from "./routes/auth.callback"

const indexRoute = index.update({ id: "/", path: "/", getParentRoute: () => root } as never)
const detailRoute = detail.update({ id: "/gallery/$sourceKey", path: "/gallery/$sourceKey", getParentRoute: () => root } as never)
const accountRoute = account.update({ id: "/account", path: "/account", getParentRoute: () => root } as never)
const uploadRoute = upload.update({ id: "/upload", path: "/upload", getParentRoute: () => root } as never)
const callbackRoute = callback.update({ id: "/auth/callback", path: "/auth/callback", getParentRoute: () => root } as never)

export const routeTree = root.addChildren([indexRoute, detailRoute, accountRoute, uploadRoute, callbackRoute])
