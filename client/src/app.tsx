import React from 'react';
import { Route, Routes } from 'react-router-dom';

// This is a temporary placeholder component from spark-framework
import CrmPage from './pages/crm/CrmPage';

import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* This Welcome component should be replaced with the actual home page content */}
        <Route index element={<CrmPage />} />
        <Route path="crm/:section" element={<CrmPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
