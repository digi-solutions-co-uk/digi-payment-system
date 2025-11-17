import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import "./Sidebar.css";

export function Sidebar() {
  const location = useLocation();
  const { userRole, logout } = useAuth();

  const menuItems = [
    { path: "/dashboard", label: "Dashboard", icon: "📊" },
    { path: "/customers", label: "Customers", icon: "👥" },
    { path: "/analytics", label: "Analytics", icon: "📈" },
    ...(userRole === "ADMIN"
      ? [
          { path: "/plans", label: "Plans", icon: "📋" },
          { path: "/staff", label: "Staff", icon: "👤" },
        ]
      : []),
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Digi Payment</h2>
      </div>
      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`nav-item ${
              location.pathname === item.path ? "active" : ""
            }`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button onClick={logout} className="logout-btn">
          Logout
        </button>
      </div>
    </div>
  );
}
