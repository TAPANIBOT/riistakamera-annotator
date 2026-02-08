"""API tests for dashboard endpoints."""
import json
import pytest


class TestDashboardAPI:
    """Test GET /api/dashboard."""

    def test_dashboard_returns_200(self, client):
        resp = client.get('/api/dashboard')
        assert resp.status_code == 200

    def test_dashboard_has_all_keys(self, client):
        resp = client.get('/api/dashboard')
        data = resp.get_json()
        expected_keys = {
            'total_images', 'annotated_count', 'empty_count',
            'unannotated_count', 'total_annotations', 'unique_species',
            'species_counts', 'hourly_activity', 'daily_activity',
            'ai_accuracy', 'ai_from_prediction_total', 'confidence_bins',
            'recent', 'species_labels',
        }
        assert expected_keys.issubset(data.keys())

    def test_dashboard_date_filter(self, client):
        resp = client.get('/api/dashboard?from_date=2026-01-28&to_date=2026-01-28')
        data = resp.get_json()
        # Only Jan 28 images should be counted
        # We have 3 annotations on Jan 28 (1 janis + 1 kauris + 1 linnut)
        assert data['total_annotations'] == 3
        # Daily activity should only have 2026-01-28
        assert '2026-01-29' not in data['daily_activity']

    def test_dashboard_species_filter_single(self, client):
        resp = client.get('/api/dashboard?species=janis')
        data = resp.get_json()
        # Only janis should be in species_counts
        assert 'janis' in data['species_counts']
        assert 'kauris' not in data['species_counts']

    def test_dashboard_species_filter_multiple(self, client):
        resp = client.get('/api/dashboard?species=janis,linnut')
        data = resp.get_json()
        for sp in data['species_counts']:
            assert sp in ('janis', 'linnut')

    def test_dashboard_recent_max_20(self, client):
        resp = client.get('/api/dashboard')
        data = resp.get_json()
        assert len(data['recent']) <= 20

    def test_dashboard_confidence_bins_length(self, client):
        resp = client.get('/api/dashboard')
        data = resp.get_json()
        assert len(data['confidence_bins']) == 10

    def test_dashboard_ai_accuracy_math(self, client):
        resp = client.get('/api/dashboard')
        data = resp.get_json()
        for sp, acc in data['ai_accuracy'].items():
            assert acc['correct'] + acc['overridden'] == acc['total'], \
                f"AI accuracy math failed for {sp}: {acc}"

    def test_dashboard_counts_add_up(self, client):
        resp = client.get('/api/dashboard')
        data = resp.get_json()
        # annotated + empty + unannotated == total_images
        total = data['annotated_count'] + data['empty_count'] + data['unannotated_count']
        assert total == data['total_images']


class TestPageRoutes:
    """Test HTML page routes."""

    def test_index_returns_200(self, client):
        resp = client.get('/')
        assert resp.status_code == 200
        assert b'dashboard' in resp.data.lower() or b'Analytiikka' in resp.data

    def test_annotator_returns_200(self, client):
        resp = client.get('/annotator')
        assert resp.status_code == 200
        assert b'canvas' in resp.data.lower()


class TestDashboardDataCorrectness:
    """Regression tests for data correctness bugs."""

    def test_total_images_respects_date_filter(self, client):
        """Bug fix: total_images should only count images in date range."""
        resp_all = client.get('/api/dashboard')
        data_all = resp_all.get_json()

        resp_day = client.get('/api/dashboard?from_date=2026-01-28&to_date=2026-01-28')
        data_day = resp_day.get_json()

        # With date filter, total should be less or equal
        assert data_day['total_images'] <= data_all['total_images']
        # Jan 28 has 2 images (3rd is Jan 29)
        assert data_day['total_images'] == 2

    def test_species_filter_affects_annotated_count(self, client):
        """Bug fix: when species filter active, annotated_count only counts matching images."""
        resp = client.get('/api/dashboard?species=janis')
        data = resp.get_json()
        # Only 1 image has janis annotation
        assert data['annotated_count'] == 1
        # Counts must still add up
        total = data['annotated_count'] + data['empty_count'] + data['unannotated_count']
        assert total == data['total_images']

    def test_day_view_has_unique_images(self, client):
        """Bug fix: day view returns unique_images count."""
        resp = client.get('/api/dashboard/day?date=2026-01-28')
        data = resp.get_json()
        assert 'unique_images' in data
        # 2 images on Jan 28, but 3 annotations
        assert data['unique_images'] == 2
        assert data['total_annotations'] == 3


class TestTableAPI:
    """Test GET /api/dashboard/table."""

    def test_table_returns_200(self, client):
        resp = client.get('/api/dashboard/table')
        assert resp.status_code == 200

    def test_table_has_pagination(self, client):
        resp = client.get('/api/dashboard/table')
        data = resp.get_json()
        assert 'rows' in data
        assert 'total' in data
        assert 'page' in data
        assert 'total_pages' in data

    def test_table_rows_have_required_fields(self, client):
        resp = client.get('/api/dashboard/table')
        data = resp.get_json()
        for row in data['rows']:
            assert 'image' in row
            assert 'species' in row
            assert 'species_label' in row
            assert 'camera_date' in row

    def test_table_sort_by_species(self, client):
        resp = client.get('/api/dashboard/table?sort=species_asc')
        data = resp.get_json()
        species = [r['species'] for r in data['rows']]
        assert species == sorted(species)

    def test_table_species_filter(self, client):
        resp = client.get('/api/dashboard/table?species=janis')
        data = resp.get_json()
        assert all(r['species'] == 'janis' for r in data['rows'])


class TestDayAPI:
    """Test GET /api/dashboard/day."""

    def test_day_requires_date(self, client):
        resp = client.get('/api/dashboard/day')
        assert resp.status_code == 400

    def test_day_returns_data(self, client):
        resp = client.get('/api/dashboard/day?date=2026-01-28')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['date'] == '2026-01-28'
        assert data['total_annotations'] == 3
        assert 'hourly_breakdown' in data
        assert 'images' in data

    def test_day_empty_date(self, client):
        resp = client.get('/api/dashboard/day?date=2020-01-01')
        data = resp.get_json()
        assert data['total_annotations'] == 0


class TestGalleryAPI:
    """Test GET /api/gallery."""

    def test_gallery_returns_200(self, client):
        resp = client.get('/api/gallery')
        assert resp.status_code == 200

    def test_gallery_pagination(self, client):
        resp = client.get('/api/gallery?per_page=2&page=1')
        data = resp.get_json()
        assert len(data['images']) <= 2
        assert data['page'] == 1

    def test_gallery_sort_confidence(self, client):
        resp = client.get('/api/gallery?sort=confidence_desc')
        data = resp.get_json()
        confs = [r['confidence'] or 0 for r in data['images']]
        assert confs == sorted(confs, reverse=True)


class TestThumbnailAPI:
    """Test GET /api/thumbnail/<filename>."""

    def test_thumbnail_returns_image(self, client):
        resp = client.get('/api/thumbnail/15339_25173_20260128_072622867.jpg')
        assert resp.status_code == 200
        assert resp.content_type.startswith('image/')

    def test_thumbnail_not_found(self, client):
        resp = client.get('/api/thumbnail/nonexistent.jpg')
        assert resp.status_code == 404


class TestAiBriefAPI:
    """Test GET /api/ai/brief."""

    def test_brief_default(self, client):
        resp = client.get('/api/ai/brief?days=90')
        assert resp.status_code == 200
        assert resp.content_type.startswith('text/plain')
        assert 'Riistakamera' in resp.data.decode('utf-8')

    def test_brief_days_param(self, client):
        resp = client.get('/api/ai/brief?days=90')
        assert resp.status_code == 200
        text = resp.data.decode('utf-8')
        assert '90pv' in text
        assert 'Havaintoja:' in text

    def test_brief_species_filter(self, client):
        resp = client.get('/api/ai/brief?days=90&species=janis')
        assert resp.status_code == 200
        text = resp.data.decode('utf-8')
        assert 'jänis' in text
        assert 'metsäkauris' not in text

    def test_brief_has_daily_and_hourly(self, client):
        resp = client.get('/api/ai/brief?days=90')
        assert resp.status_code == 200
        text = resp.data.decode('utf-8')
        assert 'Päivät:' in text
        assert 'Aktiiviset tunnit:' in text
        # Should contain weekday abbreviations
        assert any(day in text for day in ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'])

    def test_brief_detail_full(self, client):
        resp = client.get('/api/ai/brief?days=90&detail=full')
        assert resp.status_code == 200
        text = resp.data.decode('utf-8')
        assert 'Tunnit 00-23:' in text
        assert 'AI-tarkkuus:' in text

    def test_brief_invalid_days(self, client):
        resp = client.get('/api/ai/brief?days=0')
        assert resp.status_code == 400
        resp2 = client.get('/api/ai/brief?days=91')
        assert resp2.status_code == 400

    def test_brief_empty_result(self, client):
        resp = client.get('/api/ai/brief?days=90&species=ilves')
        assert resp.status_code == 200
        text = resp.data.decode('utf-8')
        assert 'Ei havaintoja' in text or 'ilves' in text.lower()

    def test_brief_token_count(self, client):
        resp = client.get('/api/ai/brief?days=90')
        text = resp.data.decode('utf-8')
        assert len(text) < 1500, f'Summary too long: {len(text)} chars'

        resp_full = client.get('/api/ai/brief?days=90&detail=full')
        text_full = resp_full.data.decode('utf-8')
        assert len(text_full) < 2000, f'Full detail too long: {len(text_full)} chars'
