import { usePath } from "./router";
import { CreateFlow } from "./screens/CreateFlow";
import { RoomScreen } from "./screens/RoomScreen";
import { ToastProvider } from "./ui/Chrome";

export function App() {
  const path = usePath();
  const room = /^\/r\/([a-z0-9]{10})\/?$/.exec(path);
  return (
    <ToastProvider>
      <div className="app">{room ? <RoomScreen key={room[1]} roomId={room[1]!} /> : <CreateFlow />}</div>
    </ToastProvider>
  );
}
