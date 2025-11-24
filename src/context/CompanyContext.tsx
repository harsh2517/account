"use client";

import { createContext, useContext, useEffect, useState } from "react";

type CompanyContextType = {
  selectedCompanyId: string | null;
  selectedCompanyName: string | null;
  setSelectedCompany: (id: string | null, name: string | null) => void;
};

const CompanyContext = createContext<CompanyContextType>({
  selectedCompanyId: null,
  selectedCompanyName: null,
  setSelectedCompany: () => {},
});

export const useCompany = () => useContext(CompanyContext);

export const CompanyProvider = ({ children }: { children: React.ReactNode }) => {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedCompanyName, setSelectedCompanyName] = useState<string | null>(null);

  useEffect(() => {
    const storedId = localStorage.getItem("selectedCompanyId");
    const storedName = localStorage.getItem("selectedCompanyName");
    if (storedId) setSelectedCompanyId(storedId);
    if (storedName) setSelectedCompanyName(storedName);
  }, []);


  //Centralized Storing Company id and name in Local Storage and in context 
  const setSelectedCompany = (id: string | null, name: string | null) => {
    if (id) localStorage.setItem("selectedCompanyId", id);
    else localStorage.removeItem("selectedCompanyId");

    if (name) localStorage.setItem("selectedCompanyName", name);
    else localStorage.removeItem("selectedCompanyName");

    setSelectedCompanyId(id);
    setSelectedCompanyName(name);
  };

  return (
    <CompanyContext.Provider
      value={{
        selectedCompanyId,
        selectedCompanyName,
        setSelectedCompany,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
};
