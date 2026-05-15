from django.db import models
from django_case_insensitive_field import CaseInsensitiveFieldMixin


class CaseInsensitiveCharField(CaseInsensitiveFieldMixin, models.CharField):
    # FYI this class is imported directly in the migration so keep that in mind pls
    def __init__(self, *args, **kwargs):
        super(CaseInsensitiveFieldMixin, self).__init__(*args, **kwargs)
